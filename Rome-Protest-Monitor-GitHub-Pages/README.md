# Rome Protest & Disruption Monitor (v1.0)

A source-led, map-based prototype for GSOC awareness of **public** demonstration notices and transportation impacts in Rome, Italy. Designed as a standalone static website for GitHub Pages (no hosted application server, paid API key, or database).

**Important:** This is not a live protest-location feed, crowd tracker, social-media surveillance service, or verified road-closure map. The interactive map shows *approximate public event locations*. The only dashed route is a **schematic** connection across approximate waypoints, **not** an exact GPS route. In-window means the *published time window*, not a confirmation that protesters are present. The dashboard never auto-promotes a keyword match into a verified event.

## Open the prototype now

Open `index.html` in Chrome, Edge, or Firefox. Reviewed events and source status load from `data/snapshot.js` even when opened directly from a local file. An interactive dark basemap requires internet access to unpkg (Leaflet) and CARTO map tiles. If these are blocked, you will see a labeled **schematic fallback** with clickable event markers.

You can also run from a local server:

```bash
python -m http.server 8080
```

Then visit `http://localhost:8080/`.

## Publish on GitHub Pages

1. Create a **new repository** (for example `Rome-Protest-Monitor`). Upload the **contents** of this folder, keeping `.github/workflows/deploy.yml` and the `data/`, `scripts/`, `tests/`, `assets/` directories intact. Commit them to the `main` branch.
2. In the repository, go to **Settings > Pages > Build and deployment > Source: GitHub Actions**.
3. Open the **Actions** tab and select **Rome protest monitor - refresh and deploy > Run workflow**. Wait for a successful deployment and use the Pages URL. The site will be public if your GitHub Pages configuration is public.
4. The workflow is scheduled at minutes 13 and 43 every hour (UTC), subject to GitHub scheduling delays and site availability. The workflow runs unit tests, scans the public RSS feed, generates a snapshot, assembles `dist/`, and deploys. No API token is needed for the source feed.
5. If GitHub Actions cannot reach the feed, the deployed dashboard shows **SOURCE CHECK INCOMPLETE**, not a misleading no-findings status. On failure, the queue will be empty and the error visible in the Discovery tab.

GitHub may disable scheduled workflows after prolonged inactivity, and no polling interval guarantees real-time coverage. You can use **Run workflow** to trigger an on-demand check. Changing the schedule is possible by editing the `cron` expression in `.github/workflows/deploy.yml`.

### What updates automatically (and what does not)

- **Automatic:** Discover new possible protest-related articles in the official Roma Mobilita RSS feed (`https://romamobilita.it/feed/`). Keywords are intentionally broad and could include false positives. New links appear in the **Discovery** review queue with publication timestamps, without any map points or threat severity.
- **Analyst-reviewed only:** Event date/time, location, impact tier, bus diversions, street lists, and coordinates in `data/events.json`. A new discovery item will **not** automatically become a verified map event. An analyst must open the original source, confirm the facts, and add/update an entry in `events.json`.
- **Time-aware:** Event cards are automatically archived once their published window ends. When the event time is unknown, the day passes before it is archived. The main filter starts at **Next 7 days**, so expired information does not linger in the operational view.
- **User-configured watchpoints:** Saved only in your browser's local storage. They are never sent to GitHub; do not put sensitive itinerary or principal location details in `data/events.json` or any publicly deployed file. The watchpoint distances use simple great-circle distance, **not road travel distance or a road-closure model**.
- **Not implemented:** Verified live crowd locations, current police cordons, social-media ingestion, official ATAC transit alert API integration, event verification without an analyst, automatic SMS/email alerts. These should not be claimed as features.

## Add or update a verified event

Edit `data/events.json` as a JSON array. Copy an existing event as a template and change:

- `id` (unique), `title`, `type`, `impact` (`high`, `moderate`, `low`), `date` (`YYYY-MM-DD`)
- `start` / `end` ISO 8601 timestamps **with Europe/Rome UTC offset** (e.g., `2026-10-30T09:00:00+01:00`); if unknown, use `null` and explain in `time_label`
- `point` = `[latitude, longitude]`, with the coordinate precision explained in `geolocation_note`
- `area`, `location`, `operational_effect`, `source_url`, `source_published`, `source_updated`, `reviewed_on`
- `route_streets` = named streets from an official notice; `route_schematic` = optional approximate polyline. **Do not draw a route from an unverified article.**
- `transit_lines` = official affected lines only. No transit lines published? Use `[]`.

To rebuild a local snapshot (especially if double-clicking `index.html`):

```bash
python scripts/build_snapshot.py
```

Committing a change to `main` also runs the workflow and creates a fresh snapshot automatically.

## Data integrity and tests

```bash
python -m unittest discover -s tests -v
python scripts/update_sources.py --fixture tests/fixture_rss.xml --output-dir /tmp/rome-monitor-fixture
```

The fixture is explicitly labeled **TEST FIXTURE ONLY** and does not contact official sources. Use `python scripts/update_sources.py` to attempt a real RSS scan when network access is available.

The primary reviewed notices in the initial dataset were checked on **October 29, 2026** from Roma Servizi per la Mobilita:

- University march: https://romamobilita.it/infomobilita/venerdi-30-ottobre-corteo-dalle-9-alle-12-sul-percorso-sapienza-piazza-dei-cinquecento/
- USB labor demonstration: https://romamobilita.it/infomobilita/venerdi-mattina-il-corteo-di-usb-in-centro-divieti-di-sosta-e-chiusure-al-traffico/
- Ponte Milvio (official summary): https://romamobilita.it/primo-piano/manifestazioni-in-citta-ecco-le-proteste-in-programma-venerdi/
- Porta San Giovanni: https://romamobilita.it/infomobilita/venerdi-manifestazione-a-san-giovanni-possibili-rallentamenti/

The USB notice's **05:30-18:00 validity period** and parking-ban times are distinct from the demonstration itself; the event time is marked unknown. The university march and USB notices have overlapping Termini references, but are not merged without evidence.

## File layout

```
index.html                       UI and layout
styles.css                       Responsive dark styling
app.js                           Maps, filters, drawers, watchpoints, export
data/events.json                 Analyst-reviewed entries; edit this file
<data/discovery.json>            Auto-generated candidate queue
<data/scan_status.json>          Auto-generated scan health
<data/snapshot.js>               Combined browser snapshot; auto-generated
scripts/update_sources.py        Official RSS discovery with explicit failure states
scripts/build_snapshot.py        Builds snapshot.js from JSON files
scripts/build_site.py            Builds dist/ (minimal GitHub Pages artifact)
tests/                          Parser and event consistency tests
.github/workflows/deploy.yml     GitHub Pages deployment and schedule
```

The app includes open-source mapping library links and OpenStreetMap/CARTO map attribution. Verify third-party terms before internal enterprise deployment. This repository is an independent GSOC concept and is not presented as an official municipal or policing service.
