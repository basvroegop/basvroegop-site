---
title: "'Softwarebug in populaire antivirusapps crashte computers'"
description: Gaten gedicht
published: 2020-04-27
tags:
  - Elders gepubliceerd
  - Bright
aliases:
  - /artikelen/softwarebug-populaire-antivirusapps-crashte-computers
author: Bastiaan Vroegop
source: Bright
sourceUrl: https://www.bright.nl/nieuws/1126235/softwarebug-populaire-antivirusapps-crashte-computers.html
socialImage: ./media/bright/softwarebug-populaire-antivirusapps-crashte-computers/0baaa46e63d8.webp
publish: true
---

**Gaten gedicht**

> [!NOTE]
> Dit artikel verscheen eerder op [Bright](https://www.bright.nl/nieuws/1126235/softwarebug-populaire-antivirusapps-crashte-computers.html).

Dat ontdekten beveiligingsonderzoekers van [Rack911 Labs](https://www.rack911labs.com/research/exploiting-almost-every-antivirus-software/). De lekken waren te vinden in onder andere Microsoft Defender, McAfee EndPoint Security, Avast, Avira en Malwarebytes.

De apps waren vatbaar voor aanvallen waarbij misbruik werd gemaakt van zogeheten junctions en symlinks. Hierbij wordt het pad naar een bestand op een andere locatie gesimuleerd, waardoor een computer denkt dat ergens iets staat dat er niet hoort te zijn.

Via die route was het mogelijk om bestanden te verwijderen waar een antivirusprogramma denkt bijvoorbeeld malware weg te halen. Door essentiële bestanden van je computer te halen, kan deze vastlopen en opnieuw opstarten. Dit opstartproces kan vervolgens worden misbruikt om bijvoorbeeld kwaadwillende software op de computer te plaatsen.

## Impact onduidelijk

Hoewel het lek een groot aantal programma's treft, moet de exacte impact nog blijken. De beveiligingsonderzoekers hebben aangetoond dat misbruik via het softwaregat mogelijk was, maar er is geen bewijs dat cybercriminelen dit ook op grote schaal hebben gedaan.

De meeste getroffen programma's hebben inmiddels updates gekregen waarin het softwarelek gedicht is. De kleine groep nog kwetsbare apps zal in de nabije toekomst vermoedelijk een update krijgen. Wie de laatste versie van een antivirusprogramma installeert, is daarom hoogstwaarschijnlijk niet meer kwetsbaar voor dit specifieke lek.
