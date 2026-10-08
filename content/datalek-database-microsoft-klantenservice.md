---
title: Enorme database klantenservice Microsoft lag op straat
description: Mega-datalek
published: 2020-01-22
tags:
  - Elders gepubliceerd
  - Bright
aliases:
  - /artikelen/datalek-database-microsoft-klantenservice
author: Bastiaan Vroegop
source: Bright
sourceUrl: https://www.bright.nl/nieuws/1125084/datalek-database-microsoft-klantenservice.html
socialImage: ./media/bright/datalek-database-microsoft-klantenservice/8c48af22427e.webp
publish: true
---

**Mega-datalek**

> [!NOTE]
> Dit artikel verscheen eerder op [Bright](https://www.bright.nl/nieuws/1125084/datalek-database-microsoft-klantenservice.html).

Dat ontdekten beveiligingsonderzoeker Bob Diachenko en het bedrijf [Comparitech](https://www.comparitech.com/blog/information-security/microsoft-customer-service-data-leak/). Volgens Microsoft is het lek in de servers inmiddels gedicht, waardoor niemand de gegevens nog kan bekijken.

De techgigant slaat op servers gesprekken van de klantenservice met klanten op. Over de gesprekken werden gegevens in tekst opgeslagen, zodat ze doorzoekbaar waren. Omdat de server verkeerd was ingesteld, kon iedere buitenstaander zonder wachtwoord binnenkomen. Onder de gegevens waren ook notities van medewerkers en omschrijvingen van de claims van klanten.

Volgens Microsoft wijst niks er op dat kwaadwillenden ook zijn ingebroken om de informatie te misbruiken.

## Privégegevens

De klantenservice vroeg klanten vaak ook naar persoonsgebonden informatie, zoals e-mailadressen en de ip-adressen van computers. Volgens Microsoft werd zulke informatie gecensureerd in de documenten, maar volgens Comparitech waren ze in sommige documenten alsnog te vinden.

In sommige gevallen waren locatiegegevens en IP-adressen van de Microsoft-klanten te zien.

Microsoft heeft in een [verklaring](https://msrc-blog.microsoft.com/2020/01/22/access-misconfiguration-for-customer-support-database/) "zijn oprechte excuses aangeboden aan alle getroffen klanten". Het bedrijf stuurt nog persoonlijke berichten naar iedereen wiens gesprekken werden opgeslagen.
