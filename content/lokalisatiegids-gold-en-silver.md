---
title: Lokalisatiegids Gold en Silver
description: |-
  Hallo! Echt heel fijn dat je een handje wil helpen met onze lokalisatie van Pokémon Goud en Zilver. Ons doel is om de gehele game Nederlands te krijgen, gebaseerd op al bestaande Nederlandse lokalisaties in o.a. de cartoon en TCG, en waar nodig onze eigen redactionele keuzes.

  Het gros van het werk is al gedaan: veel van de teksten uit de Kristal-editie zijn over te zetten naar Goud en Zilver. Het belangrijkst op dit moment zijn de Pokédex-entries, die per game verschillend zijn. Iedere Dex-teks
published: 2025-07-19
modified: 2025-07-19
author: Bastiaan Vroegop
source: Gamepraat
sourceUrl: https://gamepraat.nl/lokalisatiegids-gold-en-silver/
unlisted: true
publish: true
---

Hallo! Echt heel fijn dat je een handje wil helpen met onze lokalisatie van Pokémon Goud en Zilver. Ons doel is om de gehele game Nederlands te krijgen, gebaseerd op al bestaande Nederlandse lokalisaties in o.a. de cartoon en TCG, en waar nodig onze eigen redactionele keuzes.

Het gros van het werk is al gedaan: veel van de teksten uit de Kristal-editie zijn over te zetten naar Goud en Zilver. Het belangrijkst op dit moment zijn de Pokédex-entries, die per game verschillend zijn. Iedere Dex-tekst bevindt zich in een ander bestand. [Je kunt ze hier downloaden](https://github.com/wfowler1/pokegold-nl/tree/master/data/pokemon/dex_entries?ref=gamepraat.nl). Ga naar de map van de betreffende game, open het POKEMONNAAM.asm-estand en druk rechtsboven op 'downloadraw file'. Dit bestand is te bewerken in iedere tekstverwerker.

Vervolgens is de taak simpel: zoek in dat bestand naar de tekst tussen aanhalingstekens, zet er je eigen aanhalingstekens voor en scheid de twee met een ;-teken. Tussen jouw aanhalingstekens is plaats voor je lokalisatie. Klinkt wellicht vaag, maar is heel simpel. Hieronder een voorbeeldje. De originele tekst was als volgt:

```
	db   "It hypnotizes"
	next "itself so that it"
	next "can teleport away"

	page "when it senses"
	next "danger, even"
	next "if it is asleep.@"
```

En na het lokaliseren ziet de tekst in het bestand er zo uit:

```
	db   "Hypnotiseert zich-" ; "It hypnotizes"
	next "zelf zodat weg kan" ; "itself so that it"
	next "teleporteren zodra" ; "can teleport away"

	page "het gevaar voelt," ; "when it senses"
	next "zelfs als het" ; "danger, even"
	next "slaapt.@" ; "if it is asleep.@"
```

De gamecode leest niks wat achter een ; staat. Het maakt dit een slimme manier om de originele Engelse tekst in het bestand te houden, zodat we er bij latere eindredactierondes naar kunnen kijken.

Probeer je tekst in de originele regels te krijgen, dat is namelijk de maximale lengte van tekst in de Pokédex.

## Waar op te letten bij je vertaalwerk

Bij het schrijven van je Nederlandse tekst gelden een paar regels:

-   **Eén regel tekst mag maximaal 18 tekens lang zijn.**
-   **Staat er een #?** Dan verschijnt in de game daar de tekst 'PoKé' en mag jouw regel in totaal **nog maar 15 tekens** lang zijn.
-   Bij **<PLAY\_G>** wordt de naam van de speler ingevoerd. De maximale lengte van de naam is zeven tekens en deze placeholder is acht, dus in dat geval heb je **19 tekens**.
-   `'d` `'l` `'m` `'r` `'s` `'t` en `'v` gelden allemaal als één teken.
-   Stuit je op de naam van een aanval, voorwerp of iets anders? [Kijk in onze glossary](https://docs.google.com/spreadsheets/d/1zW1wRmgVYtHjiZYUSrRh2doq2K__3F_xWz83ouDunxY/edit?usp=sharing&ref=gamepraat.nl) wat deze in het Nederlands is! Dan zijn we consistent in onze vertaling.
-   Trucje: je kunt '…' als één teken gebruiken. Dat is een ander unicode-symbool dan driemaal de '.'

## Zo vertel je waar je mee bezig bent

In de [glossary](https://docs.google.com/spreadsheets/d/1zW1wRmgVYtHjiZYUSrRh2doq2K__3F_xWz83ouDunxY/edit?usp=sharing&ref=gamepraat.nl) staat onderin een tabblad genaamd 'Pokedex'. Zoek hier de dex entries waar je aan wil werken en tik bij 'Competion' even 'In progress aan'. Schrijf bij 'Who' je naam zodat we weten wie er aan sleutelt.

## Klaar? Uploaden maar!

Ben je klaar met je lokalisatie? Gooi het bestand in deze [Drive-map](https://drive.google.com/drive/folders/1PHzfBYBoMYMJGb3LMx3UQduFzY5DFN7h?usp=sharing&ref=gamepraat.nl). Iemand anders redigeert de tekst dan en daarna wordt hij aan een latere build van de game toegevoegd.

## Handige links op een rij

Hierboven zijn ze al hier en daar genoemd, maar nog wat handige links op een rij:

-   [Github-repo](https://github.com/wfowler1/pokecrystal-nl?ref=gamepraat.nl)
-   [Glossary](https://docs.google.com/spreadsheets/d/1zW1wRmgVYtHjiZYUSrRh2doq2K__3F_xWz83ouDunxY/edit?usp=sharing&ref=gamepraat.nl)
-   [Google Drive-map](https://drive.google.com/drive/folders/1PHzfBYBoMYMJGb3LMx3UQduFzY5DFN7h?usp=sharing&ref=gamepraat.nl)
-   [Discord](https://discord.gg/aUJDqNM3PW?ref=gamepraat.nl)
-   [Bulbapedia](https://bulbapedia.bulbagarden.net/?ref=gamepraat.nl)
