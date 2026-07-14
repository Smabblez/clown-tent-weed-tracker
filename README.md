# The Clown Tent Weed Operations

A shared GTA RP grow, sales, inventory, and payout tracker. The website is a static GitHub Pages frontend; a bound Google Apps Script writes to dedicated tabs in the gang's Google Sheet.

## Payout rule

- Grower: 70%
- Gang: 15%
- Seller: 15%

The server calculates the split from the recorded gross sale. Client-supplied payout numbers are ignored.

## Inventory units

- Grows are logged in whole trimmings.
- Sales are logged in whole boxes.
- 15 trimmings create 1 sale-ready box.

Partial stock remains attached to its grower and carries into future weeks until there are enough trimmings for another full box.

## Data flow

1. A member unlocks the site with the gang access code.
2. Website forms send records to the Apps Script web app.
3. Apps Script validates inventory and writes to Web_Grows, Web_Sales, and Web_Config.
4. Every approved device loads the same records.

Existing spreadsheet tabs are not changed.

## Weekly rollover

Closing a week starts a fresh reporting period without deleting history. Shelf inventory remains assigned to its grower, and unpaid balances remain due until they are marked paid. A later sale of carried stock is recorded in the week when the sale happens.

Member statements keep three separate totals: earned, paid out, and remaining due.

## Access

The public site contains no gang or manager password. Both codes are stored only in the Apps Script project's private Script Properties and checked on the server. Manager authorization protects payout settlement buttons, weekly rollover, roster changes, strains, and prices. Everyone with normal tracker access can still view payout balances and history.

## Setup and validation

Follow apps-script/README.md for the one-time backend deployment, then put the deployed /exec URL in config.js.

Run locally with a static server, then validate with:

    node scripts/validate.mjs
    node --check app.js
