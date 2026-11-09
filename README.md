# AD/NO

## Your next internet rabbit hole

[Explore AD/NO](https://wgx.github.io/adno/)

AD/NO combines a random adjective and noun, then looks for starting points in
Wikipedia, Open Library and the Art Institute of Chicago. Choose one source or
explore them all, follow a result to its original source, or search the web
when a prompt doesn't find a match. Descriptions and images come from the
sources; artwork images are shown only when marked public domain.
Cards identify prompt words visible in their title or details. If none are
visible, the source may have matched other information or used its own search
ranking; the app does not know the exact reason for the result.

Recent prompts and saved discoveries are stored locally in your browser, not
synced across devices. The prompt link can be copied to revisit the same
search and source filter, though results can change. Each discovery's copy
link points directly to that item at its source.

This is a static client-side app. Run it locally with `python3 -m http.server`
and open `http://localhost:8000/`. Discovery requires network access to the
source APIs; individual source failures are shown in the page. Run the
dependency-free source tests with `node --test`.
