/*
 * The GitHub side: authenticate as the App, commit the submission to a branch
 * of the gallery repository, open (or refresh) the pull request.
 *
 * Only the git data API is used, so the Worker never clones anything. The
 * App is installed on the one gallery repository with contents: write and
 * pull requests: write (issues: write for labels and comments, optional).
 */
import { importPrivateKey, signJWT } from "./jwt.js";
import { base64Encode, encoder } from "./util.js";

const API = "https://api.github.com";
const USER_AGENT = "scriptwell-gallery-submit";

export class GitHubError extends Error {
  constructor(status, message, path) {
    super(message);
    this.status = status;
    this.path = path;
  }
}

export class GitHub {
  constructor({ repository, branch = "main", appId, installationId, privateKey, fetch: fetchImpl = fetch, now = () => Date.now() }) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || "")) throw new Error("GALLERY_REPOSITORY must be owner/name");
    if (!appId || !installationId || !privateKey) throw new Error("GITHUB_APP_ID, GITHUB_INSTALLATION_ID and GITHUB_APP_PRIVATE_KEY must be set");
    this.repository = repository;
    this.owner = repository.split("/")[0];
    this.branch = branch;
    this.appId = String(appId);
    this.installationId = String(installationId);
    this.privateKey = privateKey;
    // Wrapped, never stored bare: Workers refuse the global fetch called with
    // another `this` ("Illegal invocation"), which is what `this.fetch(...)` does.
    this.fetch = (url, init) => fetchImpl(url, init);
    this.now = now;
    this.token = null;
  }

  async appJWT() {
    const key = await importPrivateKey(this.privateKey, "RS256");
    const now = Math.floor(this.now() / 1000);
    // GitHub allows a 10 minute lifetime and tolerates small clock skew backwards.
    return signJWT({ algorithm: "RS256", key, payload: { iat: now - 60, exp: now + 540, iss: this.appId } });
  }

  async installationToken() {
    if (this.token && this.token.expires > this.now() + 60_000) return this.token.value;
    const response = await this.fetch(`${API}/app/installations/${this.installationId}/access_tokens`, {
      method: "POST",
      headers: this.headers(await this.appJWT()),
      body: JSON.stringify({ permissions: { contents: "write", pull_requests: "write", issues: "write" } }),
    });
    const data = await parse(response, "/app/installations/…/access_tokens");
    this.token = { value: data.token, expires: Date.parse(data.expires_at) || this.now() + 3_000_000 };
    return this.token.value;
  }

  headers(bearer) {
    return {
      authorization: `Bearer ${bearer}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": USER_AGENT,
      "x-github-api-version": "2022-11-28",
    };
  }

  /** One API call on the gallery repository. `path` starts after /repos/{owner}/{repo}. */
  async repo(method, path, body) {
    const token = await this.installationToken();
    const response = await this.fetch(`${API}/repos/${this.repository}${path}`, {
      method,
      headers: this.headers(token),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return parse(response, path);
  }

  /** Like repo(), but a 404 is returned as null instead of thrown. */
  async repoOptional(method, path, body) {
    try {
      return await this.repo(method, path, body);
    } catch (error) {
      if (error instanceof GitHubError && error.status === 404) return null;
      throw error;
    }
  }

  /**
   * Commit `files` ({ "scripts/<id>/script.js": Uint8Array, … }) on top of the
   * base branch, point `submit/<id>` at the commit, and open a pull request
   * unless one for that branch is already open (then it is refreshed and gets
   * a comment).
   *
   * @returns {{ url: string, number: number, created: boolean }}
   */
  async submit({ id, files, title, body, commitMessage, comment }) {
    const branch = `submit/${id}`;
    const base = await this.repo("GET", `/git/ref/heads/${this.branch}`);
    const baseSha = base.object.sha;
    const baseCommit = await this.repo("GET", `/git/commits/${baseSha}`);

    const tree = [];
    for (const [path, content] of Object.entries(files)) {
      const bytes = typeof content === "string" ? encoder.encode(content) : content;
      const blob = await this.repo("POST", "/git/blobs", { content: base64Encode(bytes), encoding: "base64" });
      tree.push({ path, mode: "100644", type: "blob", sha: blob.sha });
    }
    const newTree = await this.repo("POST", "/git/trees", { base_tree: baseCommit.tree.sha, tree });
    const commit = await this.repo("POST", "/git/commits", { message: commitMessage, tree: newTree.sha, parents: [baseSha] });

    const existingRef = await this.repoOptional("GET", `/git/ref/heads/${branch}`);
    if (existingRef) await this.repo("PATCH", `/git/refs/heads/${branch}`, { sha: commit.sha, force: true });
    else await this.repo("POST", "/git/refs", { ref: `refs/heads/${branch}`, sha: commit.sha });

    const open = await this.repo("GET", `/pulls?state=open&base=${encodeURIComponent(this.branch)}&head=${encodeURIComponent(`${this.owner}:${branch}`)}`);
    if (Array.isArray(open) && open.length > 0) {
      const pull = open[0];
      await this.bestEffort("POST", `/issues/${pull.number}/comments`, { body: comment });
      return { url: pull.html_url, number: pull.number, created: false };
    }

    const pull = await this.repo("POST", "/pulls", { title, head: branch, base: this.branch, body, maintainer_can_modify: true });
    await this.bestEffort("POST", `/issues/${pull.number}/labels`, { labels: ["from-app"] });
    return { url: pull.html_url, number: pull.number, created: true };
  }

  /** Labels and comments need issues: write; a missing permission must not fail the submission. */
  async bestEffort(method, path, body) {
    try {
      await this.repo(method, path, body);
    } catch (error) {
      console.warn(`GitHub ${method} ${path} failed: ${error.message}`);
    }
  }
}

async function parse(response, path) {
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text.slice(0, 200) };
    }
  }
  if (response.status >= 400) {
    const message = data && data.message ? data.message : `HTTP ${response.status}`;
    throw new GitHubError(response.status, `GitHub ${path}: ${message}`, path);
  }
  return data;
}
