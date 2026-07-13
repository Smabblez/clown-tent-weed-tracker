# Google Sheet backend setup

The backend is a Google Apps Script bound to the existing High-End Weed spreadsheet.

1. Open the spreadsheet.
2. Choose Extensions, then Apps Script.
3. Replace the editor contents with Code.gs from this folder.
4. In Project Settings, Script properties, add ACCESS_CODE with the private code your gang will use.
5. Save and run setupTracker once. Approve the spreadsheet permission prompt.
6. Choose Deploy, New deployment, Web app.
7. Execute as Me and allow access to Anyone. The access code still gates every tracker request.
8. Copy the deployed URL ending in /exec into API_URL in the site's config.js.

When Code.gs changes, create a new deployment version and keep the same web app URL.
