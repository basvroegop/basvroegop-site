---
title: Pc-ports voor Zelda, Mario, Banjo Kazooie en meer
description: Decompiles en recompiles van klassieke games zorgen ervoor dat je ze kunt spelen met moderne extra's zoals widescreen, 60 frames per seconde en meer.
published: 2026-05-28
modified: 2026-05-28
tags:
  - Games
  - Elders gepubliceerd
  - Unpause
aliases:
  - /artikelen/pc-ports-voor-zelda-mario-banjo-kazooie-en-meer
author: Bastiaan Vroegop
source: Unpause
sourceUrl: https://www.unpause.nl/verhalen/achtergrond/decompiles-recompiles-ports-pc
socialImage: ./media/unpause/pc-ports-voor-zelda-mario-banjo-kazooie-en-meer/71971a4c405c.webp
publish: true
---

**Itereren, decompileren, hercompileren**

Na jaren sleutelen verscheen afgelopen maand een pc-port van The Legend of Zelda: Twilight Princess. Het is de zoveelste keer dat fans een oude klassieker naar moderne tijden trekken, met hogere framerates, mooiere textures en talloze andere verbeteringen.

> [!NOTE]
>
> Dit artikel verscheen eerder op [Unpause](https://www.unpause.nl/verhalen/achtergrond/decompiles-recompiles-ports-pc/).

Diep in je geheugen zitten wel de momenten dat je op een dikke beeldbuis door Mario 1-1 sprong of voor het eerst Ganondorf versloeg. In een nostalgische bui start je eens een (legaal verworven!) rombestand in een emulator om dat ene moment uit je jeugd opnieuw te beleven. En dan word je geconfronteerd met wat je was vergeten: de lage resolutie en framerate, de frustrerende camerabesturing. Het gebrek aan een coherent savesysteem.

Een groep programmeurs is bezig die oude games speelbaar te maken. Niet zoals ze toen waren, maar zoals hoe wij ze herinneren. Klassiekers worden tot op de laatste regel code gerepliceerd, om ports te maken met ondersteuning voor moderne vernuftigheden. Ports die er uit zien zoals je dacht dat die klassieker er altijd uit zag, met besturing die je door moderne games bent gaan verwachten.

## De beperkingen van emulatie

Jarenlang was emulatie het walhalla voor nostalgische gamers. Een slim stuk software kan de gamecode voor een oude spelcomputer vertalen naar iets dat een moderne pc of smartphone snapt, waardoor je alleen nog maar een (legaal verworven!) rombestand hoeft te laden om oude favorieten te spelen. Geen oude beeldbuis of gameconsole vereist.

Met emulatie kun je een oude game als vanouds spelen, maar ben je grotendeels gebonden aan hoe dat spel toen in elkaar zat. Een Super Nintendo-game speelt altijd in een resolutie van 240 pixels hoog, de lange laadtijden tussen gevechten in Chrono Trigger op de PlayStation zijn er bij emulatie nog steeds. In een Game Boy-game kun je niet ineens extra knoppen toevoegen – de originele handheld had er maar twee.

Kleine problemen zijn her en der aangepakt met romhacks en texturepacks, maar een rom blijft een rom. Om een klassiek spel echt te moderniseren en fijn speelbaar te maken, heb je een volwaardige port voor moderne computersystemen nodig.

## Decompilaties en hercompilaties

Bij een decompilatie (decompilation) wordt iedere regel code van een game minutieus nagemaakt. Een buitengewoon complex proces, omdat de originele broncode niet voor anderen inzichtelijk is. De makers van een decompilatie zijn als automonteurs die een oldtimer proberen na te bouwen, zonder dat ze ooit de motorkap open mogen maken. Is er een decompilatie gemaakt, dan kan die daarna de basis vormen voor een port van dat spel naar andere platformen.

Een game decompileren kost onwijs veel tijd, waarbij een team zich op slechts één spel tegelijkertijd kan richten. Wat dat betreft zijn recente hercompilaties (recompilations) efficiënter: daarbij wordt de kern van een spelcomputer nagebouwd, zodat individuele spellen geport kunnen worden zonder de gehele code hiervan te decompileren.

## Breedbeeld met 60 frames per seconde

De ports die hieruit voortvloeien kunnen véél meer dan een simpel geëmuleerd rommetje. Een pc-versie van Ocarina of Time is speelbaar met 60 frames per seconde, in plaats van de reguliere 20 frames. Iets dat onmogelijk is goed te implementeren bij emulatie, omdat de natuurwetten van Link’s virtuele wereld van streek raken zodra alles drie keer zo vloeiend loopt.

De onhandige camerabediening van Zelda kan worden toegewezen aan de rechter analoge stick op een moderne controller, op de d-pad is plek gemaakt om nog eens vier extra wapens en voorwerpen mee te gebruiken. En iedere keer dat je een kamer binnenloopt wordt een autosave gemaakt – zoals je van een moderne game mag verwachten.

Ocarina of Time is slechts één van de spellen die op deze manier een waardige pc-port heeft ontvangen. Afgelopen jaren zijn veel van de grootste Nintendo 64-hits naar andere platformen getild, met als meest recente Banjo Kazooie. Al deze versies zitten vol met vergelijkbare extra’s: moderne besturing, hogere framerates en ondersteuning voor allerlei resoluties, zodat je nooit meer zwarte balken aan weerszijden van je scherm hebt.

## Neem je eigen rom mee

Net als bij emulators is het juridisch spannend of grote gamebedrijven ooit zullen proberen deze projecten offline te halen. Dat is tot dusver nog niet gebeurd. Om van ieder project gebruik te maken moet je ook een (legaal verworven!) rombestand inladen, zodat in het programmeerproject geen illegaal hergebruikte gamecode of afbeeldingen zitten.

Hieronder vind je een lijst van de interessantste ports op basis van een decompilatie of hercompilatie, gesorteerd op spelcomputer.

## Nintendo 64

-   **Banjo Kazooie** – [BanjoRecomp](https://github.com/BanjoRecomp/BanjoRecomp) is een hercompilatie met moderne camerabesturing, hogere framerates en resoluties en ondersteuning voor texturepacks en mods. De makers hebben al een paar eigen levelpacks uitgebracht.
-   **Dinosaur Planet** – [dino-recomp](https://github.com/DinosaurPlanetRecomp/dino-recomp) is een hercompilatie van de game, met ondermeer ondersteuning voor mods en texturepacks.
-   **Dr. Mario 64** – [drmario64\_recomp\_plus](https://github.com/theboy181/drmario64_recomp_plus) is een hercompilatie die je ook de kleuren van de pilletjes laat veranderen.
-   **Duke Nukem Zero Hour** – [DNZHRecomp](https://github.com/sonicdcer/DNZHRecomp) port de oude game met breedbeeldondersteuning, hogere framerates en makkelijkere menu’s.
-   **Goemon 64** – [Goemon64Recomp](https://github.com/klorfmorf/Goemon64Recomp) verhoogt de resolutie, biedt breedbeeldondersteuning en hogere framerates en laadt veel sneller dan het vaak logge origineel.
-   **Mario Kart 64** – [SpaghettiKart](https://github.com/HarbourMasters/SpaghettiKart) biedt hogere resoluties en framerates. Deze is gemaakt door hetzelfde team achter Ship of Harkinian. [MarioKart64Recomp](https://github.com/sonicdcer/MarioKart64Recomp) is ook als hercompilatie te downloaden.
-   **Perfect Dark** – [Perfect\_Dark](https://github.com/fgsfdsfgs/perfect_dark) heeft naast gebruikelijke verbeteringen zoals hogere framerates en resoluties ook aanpassingen specifiek voor een shooter: je kunt de game met een muis spelen en de ‘field of view’ aanpassen.
-   **Star Fox 64** – [Starship](https://github.com/HarbourMasters/Starship) is wederom van het team achter Ship of Harkinian en biedt extra’s zoals moderne controls, hogere resoluties en framerates en ondersteuning voor texturepacks. Er is ook een hercompilatie genaamd [Starfox64Recomp](https://github.com/sonicdcer/Starfox64Recomp).
-   **Super Mario 64** – [SM64Plus](https://github.com/MorsGames/sm64plus) is een uitgebreide port van Mario 64, met betere besturing, een moderne camera, meer manieren waarop Mario kan bewegen en ondersteuning voor 60 frames per seconde.
-   **The Legend of Zelda: Majora’s Mask** – Deze pc-port komt in twee smaken. [2ship2harkinian](https://github.com/HarbourMasters/2ship2harkinian) is een port door hetzelfde team achter Ship of Harkinian, met vergelijkbare functies. [Zelda 64: Recompiled](https://github.com/Zelda64Recomp/Zelda64Recomp) is een hercompilatie met ongeveer dezelfde functionaliteit, waarbij het véél makkelijker is om HD-textures en mods toe te voegen.
-   **The Legend of Zelda: Ocarina of Time** – [Ship of Harkinian](https://github.com/HarbourMasters/Shipwright) voorziet de klassieke Zelda-game met analoge camerabesturing, 60 frames per seconde en ondersteuning voor extra’s zoals texturepacks en ondersteuning voor mods zoals een randomizer.

## NES

-   **The Legend of Zelda** – [ZQuest Classic](https://zquestclassic.com/releases/) is een simpele pc-port van de eerste Zelda, die zelfs een webversie heeft om in je browser te spelen.

## SNES

-   **Super Mario World** – [smw](https://github.com/snesrev/smw) is nog een port van de ontwikkelaar achter zelda3 en sm. Met vergelijkbare verbeteringen.
-   **Super Metroid** – [sm](https://github.com/snesrev/sm) is een Metroid-port van dezelfde ontwikkelaar achter de Zelda-port hierboven. Biedt betere besturing, kortere laadtijden en andere aspectratios.
-   **The Legend of Zelda: A Link to the Past** – [zelda3](https://github.com/snesrev/zelda3) voegt een paar simpele verbeteringen toe, waaronder experimentele breedbeeldondersteuning, kortere laadtijden en de mogelijkheid twee voorwerpen op je actieknoppen te zetten.

## Mega Drive

-   **Streets of Rage** – [SOR2](https://www.sor2newera.com/#Download) port de klassieke beat-‘em-up naar Windows, Mac, Linux en Android. Biedt ook ondersteuning voor mods.

## PlayStation

-   **Doom** – [PsyDoom](https://github.com/BodbDearg/PsyDoom) is iets dat we nooit eerder hadden: een port van Doom.
-   **Driver 2** – [ReDriver2](https://github.com/OpenDriver2/REDRIVER2) is vooral een technisch hoogstandje dat zelfs in je webbrowser draait.
-   **The Legend of Dragoon** – [Severed Chains](https://legendofdragoon.org/projects/severed-chains/) port de klassieke PlayStation-rpg en biedt extra’s zoals hogere resoluties en betere laadtijden.
-   **WipeOut** – [wipeout-phantom-edition](https://github.com/wipeout-phantom-edition/wipeout-phantom-edition) laat je de razendsnelle PlayStation-racer spellen met de resolutie en framerate die daarbij hoort.

## PlayStation 2

-   **Jak & Daxter en Jak II** – [OpenGOAL](https://opengoal.dev/docs/usage/installation/) is een pc-port van de originele engine achter de Jak & Daxter-games, waarvan de eerste twee titels nu speelbaar zijn met moderne controls en hogere resoluties. Jak III is in ontwikkeling.

## Wii U

-   **The Legend of Zelda: Twilight Princess** – De meest recente noemenswaardige port is Dusklight, dat Twilight Princess moderniseert met hogere framerates, extra’s zoals fast travel en ondersteuning voor mods.
