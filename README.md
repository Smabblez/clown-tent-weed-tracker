# The Clown Tent Weed Operations

A shared GTA RP grow, sales, inventory, and payout tracker. The website is a static GitHub Pages frontend; a bound Google Apps Script writes to dedicated tabs in the gang's Google Sheet.

## Payout rule

- Grower: 70%
- Gang: 15%
- Seller: 15%

The server calculates the split from the recorded gross sale. Client-supplied payout numbers are ignored. Supply costs are recovered only from the gang's 15%; grower and seller payouts are never reduced. Any supply balance that the current gang share cannot cover carries into later sales.

At the usual $3,000 box sale, the split is $2,100 to the grower, $450 to the seller, and a $450 gang share that can cover the typical $450 grow cost.

## Inventory units

- Grows are logged in whole trimmings.
- Sales are logged in whole boxes.
- 15 trimmings create 1 sale-ready box.

Partial stock remains attached to its grower and carries into future weeks until there are enough trimmings for another full box.

## Data flow

1. A member unlocks the site with the gang access code.
2. Website forms send records to the Apps Script web app.
3. Apps Script validates inventory and writes to Web_Grows, Web_Supplies, Web_Sales, Web_Corrections, and Web_Config.
4. Every approved device loads the same records.

Existing spreadsheet tabs are not changed.

## Weekly rollover

Closing a week starts a fresh reporting period without deleting history. Shelf inventory remains assigned to its grower, supply costs carry forward until recovered from gang shares, and unpaid balances remain due until they are marked paid. A later sale of carried stock is recorded in the week when the sale happens.

Member statements keep three separate totals: earned, paid out, and remaining due.

## Access

The public site contains no gang or manager password. Both codes are stored only in the Apps Script project's private Script Properties and checked on the server. Payout settlement buttons exist only inside the unlocked Manager page; manager authorization is also enforced by the backend. Everyone with normal tracker access can still view payout balances and history.

Managers can correct or delete existing grow, supply, and sale entries from the site. They can also reopen an individual grower, seller, or supply reimbursement that was marked paid by mistake. Deleting a sale removes its payout and restores its boxes to inventory; deleting a supply removes its reimbursement and stops it from affecting future supply recovery. Deleting a grow is blocked when its stock is needed by recorded sales. Records are soft-deleted from live totals rather than erased from the sheet, and every edit, payout reopen, or deletion saves its before/after values and reason in Web_Corrections. Any sale correction that changes a person, strain, box count, or price reopens both payout statuses; changing a supply buyer, quantity, or cost reopens its reimbursement.

The Manager payout queue supports selecting multiple unpaid grower or seller shares and supply reimbursements, then marking them paid in one confirmed batch. A supply purchase has two separate effects: it increases the gang's unrecovered supply balance, and it creates a reimbursement payable to the member recorded in `buyer`. The batch action only updates the selected settlement timestamps under the existing manager authorization and document lock, then returns a fresh full tracker snapshot; it does not rewrite sale, inventory, member, price, or correction data.

The frontend submits one server-side `settlePayouts` request for the selected sale shares and supply reimbursements. Individual payout buttons are intentionally omitted from the queue; selecting one checkbox and pressing `Pay selected` handles a one-off payment without a second interaction pattern.

## Setup and validation

Follow apps-script/README.md for the one-time backend deployment, then put the deployed /exec URL in config.js.

Run locally with a static server, then validate with:

    node scripts/validate.mjs
    node --check app.js

