# basvroegop.nl

Persoonlijk publicatiearchief van Bas Vroegop, gebouwd met [Quartz 5](https://quartz.jzhao.xyz/).

## Inhoud

- `content/artikelen/`: 316 gepubliceerde artikelen en nieuwsbrieven.
- `content/media/`: lokaal opgeslagen afbeeldingen die door die publicaties worden gebruikt.
- `scripts/import-publications.mjs`: reproduceerbare import uit de publieke Ghost Content API, de Arc-verzameling en de oorspronkelijke publicaties bij Bright, AD en NU.nl.
- `data/import-report.json`: verslag van de laatste import.

De importer gebruikt bewust niet de map `/Freelancen`: voor extern verschenen verhalen geldt de door de betreffende redactie gepubliceerde versie als bron.

## Lokaal werken

```bash
npm ci
npx quartz build --serve
```

Een bestaande import opnieuw uitvoeren:

```bash
npm run import:publications -- --force
```

Let op: `--force` vervangt geïmporteerde Markdown door de opnieuw opgehaalde bronversie.

## Publiceren

Elke push naar `main` bouwt de site en publiceert het resultaat met GitHub Pages. Stel bij **Settings → Pages** de bron in op **GitHub Actions** en voeg daar `basvroegop.nl` als custom domain toe.

De contentmap kan rechtstreeks als `/vaults/Bas/Bas/Publicaties` in de Obsidian-container worden gemount. Daardoor bewerkt Obsidian exact dezelfde Markdown-bestanden als Git, zonder een tweede kopie of synchronisatieconflicten.
