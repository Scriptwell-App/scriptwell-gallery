// @name        Book Lookup
// @description Find a book by title, author or ISBN with Open Library
// @permissions network
// @icon        text.book.closed.fill
// @color       #7C2D12
// @version     1.0.0
// @author      scriptwell
// @category    books

// Use it from Shortcuts with the search text as Input, or run it here.
// Data: https://openlibrary.org (free, no key).

async function search(query) {
  const url = new URL("https://openlibrary.org/search.json");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "5");
  url.searchParams.set("fields", "title,author_name,first_publish_year,number_of_pages_median");

  const response = await fetch(url, { timeout: 10000 });
  if (response.status === 422) return []; // Open Library's answer to a query it cannot search for
  if (!response.ok) throw new Error(`Open Library returned ${response.status}`);
  return (await response.json()).docs;
}

Script.run(async (input) => {
  let query = input;
  if (!query && Script.env.mode === "app") query = await UI.prompt({ title: "Find a book", placeholder: "Title, author or ISBN" });
  if (!query || query.trim().length < 3) return "Give me a title, an author or an ISBN (at least three characters).";

  const books = await search(query);
  if (books.length === 0) return `Nothing found for “${query}”.`;

  return books.map((book) => {
    const author = book.author_name?.slice(0, 2).join(", ") ?? "Unknown author";
    const year = book.first_publish_year ? `, ${book.first_publish_year}` : "";
    const pages = book.number_of_pages_median ? `, ${book.number_of_pages_median} pages` : "";
    return `${book.title} — ${author}${year}${pages}`;
  }).join("\n");
});
