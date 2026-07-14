# Google Sheet backend setup

The backend is a Google Apps Script bound to the existing High-End Weed spreadsheet.

1. Open the spreadsheet.
2. Choose Extensions, then Apps Script.
3. Replace the editor contents with Code.gs from this folder.
4. In Project Settings, Script properties, add ACCESS_CODE with the gang code and ADMIN_CODE with the manager password.
5. Save and run setupTracker once. Approve the spreadsheet permission prompt.
6. Choose Deploy, New deployment, Web app.
7. Execute as Me and allow access to Anyone. The access code still gates every tracker request.
8. Copy the deployed URL ending in /exec into API_URL in the site's config.js.

When Code.gs changes, create a new deployment version and keep the same web app URL.

The current inventory contract stores grow intake as whole trimmings and sales as whole boxes. The backend converts 15 trimmings into 1 sale-ready box and automatically adds the `trimmings` header to an existing Web_Grows tab while preserving legacy `boxes` rows.

Supply purchases are stored in Web_Supplies as buyer, item, quantity, unit cost, and total. Future sales recover the outstanding supply balance only from the gang's 15% share; grower and seller payouts remain 70% and 15% of gross. The backend adds `supplyDeduction` to Web_Sales and carries unrecovered supply costs across weeks.

Payout balances are visible to normal tracker users, but `settleSale` requires the private `ADMIN_CODE` before any payout can be marked paid.
