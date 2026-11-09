const test = require("node:test");
const assert = require("node:assert/strict");
const { SOURCES, fetchResults } = require("../app.js");

test("source URLs encode the prompt and constrain results", () => {
    for (const source of Object.values(SOURCES)) {
        const url = new URL(source.url("ancient & unusual map"));
        assert.equal(url.searchParams.get(source === SOURCES.wikipedia ? "gsrsearch" : "q"), "ancient & unusual map");
        assert.equal(url.searchParams.get(source === SOURCES.wikipedia ? "gsrlimit" : "limit"), "3");
    }
    assert.equal(new URL(SOURCES.wikipedia.url("test")).searchParams.get("origin"), "*");
});

test("Wikipedia cards use plain extracts and search ranking", () => {
    const cards = SOURCES.wikipedia.parse({ batchcomplete: true, query: { pages: [
        { pageid: 2, index: 2, title: "Second" },
        { pageid: 1, index: 1, title: "First", extract: "An extract.", thumbnail: { source: "https://example.org/a.jpg" } }
    ] } });
    assert.deepEqual(cards.map(card => card.title), ["First", "Second"]);
    assert.equal(cards[0].description, "An extract.");
    assert.equal(cards[0].url, "https://en.wikipedia.org/?curid=1");
    assert.deepEqual(SOURCES.wikipedia.parse({ batchcomplete: true }), []);
    assert.throws(() => SOURCES.wikipedia.parse({}));
});

test("book cards link to works and use available metadata", () => {
    const cards = SOURCES.books.parse({ docs: [
        { key: "/works/OL123W", title: "A book", author_name: ["An Author"], first_publish_year: 1900, cover_i: 123 },
        { key: "/invalid", title: "Invalid" }
    ] });
    assert.equal(cards.length, 1);
    assert.equal(cards[0].url, "https://openlibrary.org/works/OL123W");
    assert.equal(cards[0].description, "An Author · 1900");
    assert.equal(cards[0].image, "https://covers.openlibrary.org/b/id/123-M.jpg");
    assert.throws(() => SOURCES.books.parse({}));
});

test("art cards show only public-domain images", () => {
    const cards = SOURCES.art.parse({ data: [
        { id: 1, title: "Public", artist_display: "Artist", date_display: "1900", is_public_domain: true, image_id: "abcd-1234" },
        { id: 2, title: "Restricted", is_public_domain: false, image_id: "abcd-1234" }
    ] });
    assert.equal(cards[0].url, "https://www.artic.edu/artworks/1");
    assert.equal(cards[0].description, "Artist · 1900");
    assert.match(cards[0].image, /abcd-1234/);
    assert.equal(cards[1].image, null);
    assert.throws(() => SOURCES.art.parse({}));
});

test("fetchResults reports HTTP and API errors and filters untitled items", async t => {
    const originalFetch = global.fetch;
    t.after(() => { global.fetch = originalFetch; });
    global.fetch = async () => ({ ok: false, status: 503 });
    await assert.rejects(fetchResults(SOURCES.books, "test"), /HTTP 503/);
    global.fetch = async () => ({ ok: true, json: async () => ({ error: {} }) });
    await assert.rejects(fetchResults(SOURCES.books, "test"), /Source returned an error/);
    global.fetch = async () => ({ ok: true, json: async () => ({ docs: [
        { key: "/works/OL1W", title: "Book" }, { key: "/works/OL2W" }
    ] }) });
    assert.equal((await fetchResults(SOURCES.books, "test")).length, 1);
});
