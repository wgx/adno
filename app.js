/* The sources return their own descriptions; no generated summaries are used. */
const SOURCES = {
    wikipedia: {
        name: "Wikipedia",
        description: "Articles",
        searchDomain: "en.wikipedia.org",
        url: phrase => `https://en.wikipedia.org/w/api.php?${new URLSearchParams({
            action: "query", generator: "search", gsrsearch: phrase, gsrlimit: "3",
            prop: "extracts|pageimages", exintro: "1", explaintext: "1", exsentences: "2",
            piprop: "thumbnail", pithumbsize: "400", format: "json", formatversion: "2", origin: "*"
        })}`,
        parse: data => {
            if (!("batchcomplete" in data) || (data.query && !Array.isArray(data.query.pages))) {
                throw new Error("Invalid Wikipedia response");
            }
            return (data.query?.pages || []).filter(page => Number.isInteger(page.pageid)).sort((a, b) => a.index - b.index).map(page => ({
                id: String(page.pageid), title: page.title,
                url: `https://en.wikipedia.org/?curid=${encodeURIComponent(page.pageid)}`,
                description: page.extract || "Explore this article on Wikipedia.",
                image: page.thumbnail?.source
            }));
        }
    },
    books: {
        name: "Open Library",
        description: "Books",
        searchDomain: "openlibrary.org",
        url: phrase => `https://openlibrary.org/search.json?${new URLSearchParams({
            q: phrase, limit: "3", fields: "key,title,author_name,first_publish_year,cover_i"
        })}`,
        parse: data => {
            if (!Array.isArray(data.docs)) throw new Error("Invalid Open Library response");
            return data.docs.filter(book => /^\/works\/OL\d+W$/.test(book.key)).map(book => ({
                id: book.key, title: book.title, url: `https://openlibrary.org${book.key}`,
                description: [book.author_name?.join(", "), book.first_publish_year].filter(Boolean).join(" · ") || "Explore this book on Open Library.",
                image: book.cover_i ? `https://covers.openlibrary.org/b/id/${encodeURIComponent(book.cover_i)}-M.jpg` : null
            }));
        }
    },
    art: {
        name: "Art Institute of Chicago",
        description: "Artworks",
        searchDomain: "artic.edu",
        url: phrase => `https://api.artic.edu/api/v1/artworks/search?${new URLSearchParams({
            q: phrase, limit: "3", fields: "id,title,artist_display,date_display,image_id,is_public_domain"
        })}`,
        parse: data => {
            if (!Array.isArray(data.data)) throw new Error("Invalid Art Institute response");
            return data.data.filter(art => Number.isInteger(art.id)).map(art => ({
                id: String(art.id), title: art.title, url: `https://www.artic.edu/artworks/${art.id}`,
                description: [art.artist_display, art.date_display].filter(Boolean).join(" · ") || "Explore this artwork at the Art Institute of Chicago.",
                image: art.is_public_domain && typeof art.image_id === "string" && /^[a-f0-9-]+$/i.test(art.image_id)
                    ? `https://www.artic.edu/iiif/2/${art.image_id}/full/400,/0/default.jpg` : null
            }));
        }
    }
};

async function fetchResults(source, phrase, signal) {
    const response = await fetch(source.url(phrase), { signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.error) throw new Error("Source returned an error");
    return source.parse(data).filter(item => typeof item.title === "string" && item.title.trim());
}

function matchExplanation(item, phrase, sourceName) {
    const words = text => text.normalize("NFC").toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) || [];
    const visibleWords = new Set(words(`${item.title} ${item.description}`));
    const matches = [...new Set(words(phrase))].filter(word => visibleWords.has(word));
    return matches.length
        ? `Prompt words in title or details: ${matches.map(word => `“${word}”`).join(", ")}.`
        : `${sourceName} returned this result; no prompt words appear in the title or details.`;
}

if (typeof module !== "undefined" && module.exports) module.exports = { SOURCES, fetchResults, matchExplanation };

if (typeof document !== "undefined") {
    const $ = id => document.getElementById(id);
    const sourceKeys = Object.keys(SOURCES);
    const historyKey = "adno.history.v1";
    const favoritesKey = "adno.favorites.v1";
    const hosts = { wikipedia: "en.wikipedia.org", books: "openlibrary.org", art: "www.artic.edu" };
    let activeController;
    let requestId = 0;
    let phrase = "";

    function notice(message) { $("notice").textContent = message; }
    function readList(key) {
        try {
            const value = JSON.parse(localStorage.getItem(key) || "[]");
            return Array.isArray(value) ? value : [];
        } catch (error) {
            notice("Your saved items are unavailable in this browser.");
            return [];
        }
    }
    function writeList(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (error) {
            notice("Could not save on this device. Check your browser's storage settings.");
            return false;
        }
    }
    function validFavorite(item) {
        if (!item || !sourceKeys.includes(item.source) || typeof item.id !== "string" || typeof item.title !== "string" || typeof item.url !== "string") return false;
        try {
            const url = new URL(item.url);
            return url.protocol === "https:" && url.hostname === hosts[item.source];
        } catch (error) { return false; }
    }
    let history = readList(historyKey).filter(item => item && typeof item.phrase === "string" && item.phrase.length <= 120 && (item.mode === "all" || sourceKeys.includes(item.mode))).slice(0, 10);
    let favorites = readList(favoritesKey).filter(validFavorite).slice(0, 100);

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text) node.textContent = text;
        return node;
    }
    function externalLink(text, url) {
        const link = element("a", "", text);
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        return link;
    }
    function promptUrl(text, mode) {
        const url = new URL(location.href);
        url.search = "";
        url.hash = "";
        url.searchParams.set("q", text);
        if (mode !== "all") url.searchParams.set("source", mode);
        return url.href;
    }
    async function copyLink(url, success, fallback) {
        try {
            await navigator.clipboard.writeText(url);
            notice(success);
        } catch (error) {
            notice(fallback);
        }
    }
    function renderHistory() {
        const container = $("history");
        container.replaceChildren();
        if (!history.length) container.append(element("p", "empty", "Your recent prompts will appear here."));
        history.forEach(item => {
            const button = element("button", "history-item", item.phrase);
            button.type = "button";
            button.title = item.mode === "all" ? "All sources" : SOURCES[item.mode].name;
            button.addEventListener("click", () => {
                $("sourceSelect").value = item.mode;
                discover(item.phrase);
            });
            container.append(button);
        });
    }
    function renderFavorites() {
        const container = $("favorites");
        container.replaceChildren();
        if (!favorites.length) container.append(element("p", "empty", "Save a discovery to find it again later."));
        favorites.forEach(item => {
            const row = element("div", "saved-item");
            const details = element("div", "saved-details");
            details.append(externalLink(item.title, item.url), element("small", "", SOURCES[item.source].name));
            const remove = element("button", "text-button", "Remove");
            remove.type = "button";
            remove.setAttribute("aria-label", `Remove ${item.title} from saved discoveries`);
            remove.addEventListener("click", () => toggleFavorite(item));
            row.append(details, remove);
            container.append(row);
        });
    }
    function toggleFavorite(item) {
        const exists = favorites.some(saved => saved.source === item.source && saved.id === item.id);
        const updated = exists
            ? favorites.filter(saved => saved.source !== item.source || saved.id !== item.id)
            : [{ source: item.source, id: item.id, title: item.title, url: item.url }, ...favorites].slice(0, 100);
        if (!writeList(favoritesKey, updated)) return;
        favorites = updated;
        renderFavorites();
        document.querySelectorAll("[data-favorite]").forEach(button => {
            if (button.dataset.favorite === `${item.source}:${item.id}`) {
                button.textContent = exists ? "Save" : "Saved";
                button.setAttribute("aria-pressed", String(!exists));
            }
        });
        notice(exists ? "Discovery removed from saved items." : "Discovery saved on this device.");
    }
    function makeCard(item, key) {
        const card = element("article", "card");
        if (item.image && /^https:\/\//.test(item.image)) {
            const image = element("img", "card-image");
            image.src = item.image;
            image.alt = "";
            image.loading = "lazy";
            image.addEventListener("error", () => image.remove());
            card.append(image);
        }
        const body = element("div", "card-body");
        body.append(element("p", "card-source", SOURCES[key].name));
        const title = element("h3");
        title.append(externalLink(item.title, item.url));
        body.append(title, element("p", "card-description", item.description),
            element("p", "card-match", matchExplanation(item, phrase, SOURCES[key].name)));
        const actions = element("div", "card-actions");
        const save = element("button", "save-button", favorites.some(saved => saved.source === key && saved.id === item.id) ? "Saved" : "Save");
        save.type = "button";
        save.dataset.favorite = `${key}:${item.id}`;
        save.setAttribute("aria-pressed", String(save.textContent === "Saved"));
        save.setAttribute("aria-label", `Save ${item.title}`);
        save.addEventListener("click", () => toggleFavorite({ ...item, source: key }));
        const share = element("button", "text-button", "Copy link");
        share.type = "button";
        share.setAttribute("aria-label", `Copy link to ${item.title}`);
        share.addEventListener("click", () => copyLink(item.url, "Discovery link copied.", "Could not copy the link. You can copy it from the discovery title instead."));
        actions.append(save, share);
        body.append(actions);
        card.append(body);
        return card;
    }
    function discover(text) {
        phrase = text;
        const mode = $("sourceSelect").value;
        const id = ++requestId;
        if (activeController) activeController.abort();
        activeController = new AbortController();
        const controller = activeController;
        $("randomPhrase").textContent = phrase;
        const searchUrl = `https://duckduckgo.com/?${new URLSearchParams({ q: phrase })}`;
        $("ddgLink").href = searchUrl;
        $("heroDdgLink").href = searchUrl;
        $("domainLink").href = `https://domainr.com/?${new URLSearchParams({ q: phrase.replace(/\s/g, "") })}`;
        $("sharePrompt").href = promptUrl(phrase, mode);
        window.history.replaceState(null, "", $("sharePrompt").href);
        const updatedHistory = [{ phrase, mode }, ...history.filter(item => item.phrase !== phrase || item.mode !== mode)].slice(0, 10);
        if (writeList(historyKey, updatedHistory)) history = updatedHistory;
        renderHistory();
        const container = $("results");
        container.replaceChildren();
        const keys = mode === "all" ? sourceKeys : [mode];
        keys.forEach(key => {
            const section = element("section", "source-section");
            const heading = element("h3", "source-heading", `${SOURCES[key].description} · ${SOURCES[key].name}`);
            const content = element("div", "result-grid");
            content.append(element("p", "empty", "Looking for discoveries…"));
            section.append(heading, content);
            container.append(section);
            const sourceController = new AbortController();
            const abortSource = () => sourceController.abort();
            controller.signal.addEventListener("abort", abortSource, { once: true });
            let timedOut = false;
            const timeout = setTimeout(() => {
                timedOut = true;
                sourceController.abort();
            }, 12000);
            fetchResults(SOURCES[key], phrase, sourceController.signal).then(items => {
                if (id !== requestId) return;
                content.replaceChildren();
                if (!items.length) content.append(element("p", "empty", "No matches for this prompt. Try another or search the web."));
                else items.forEach(item => content.append(makeCard(item, key)));
            }).catch(error => {
                if (id !== requestId) return;
                console.error(`Could not load ${SOURCES[key].name}:`, error);
                const reason = timedOut ? "took too long to respond" : "is unavailable right now";
                const message = element("p", "empty", `${SOURCES[key].name} ${reason}. Try again or `);
                const query = new URLSearchParams({ q: `site:${SOURCES[key].searchDomain} ${phrase}` });
                message.append(externalLink("search the web", `https://duckduckgo.com/?${query}`), ".");
                content.replaceChildren(message);
            }).finally(() => {
                clearTimeout(timeout);
                controller.signal.removeEventListener("abort", abortSource);
            });
        });
    }
    function randomPhrase() {
        return `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${nouns[Math.floor(Math.random() * nouns.length)]}`;
    }
    $("generateBtn").addEventListener("click", () => discover(randomPhrase()));
    $("sourceSelect").addEventListener("change", () => discover(phrase));
    $("copyPrompt").addEventListener("click", () => copyLink($("sharePrompt").href, "Prompt link copied.", "Could not copy the link. You can copy it from “Link to this prompt” instead."));
    const params = new URLSearchParams(location.search);
    const requestedMode = params.get("source");
    $("sourceSelect").value = sourceKeys.includes(requestedMode) ? requestedMode : "all";
    const requestedPhrase = params.get("q")?.trim();
    renderFavorites();
    discover(requestedPhrase && requestedPhrase.length <= 120 ? requestedPhrase : randomPhrase());
}
