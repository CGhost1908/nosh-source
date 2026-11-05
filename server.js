// Standalone OAuth callback server (Used if executed directly)
const express = require('express');
const app = express();
const port = process.env.PORT || 2222;

app.get('/callback', (req, res) => {
    res.send('OAuth callback received. Return to Nosh.');
});

app.get('/drive-callback', (req, res) => {
    res.send('Google Drive callback received. Return to Nosh.');
});

if (require.main === module) {
    app.listen(port, '127.0.0.1', () => {
        console.log(`Standalone Nosh server running on http://127.0.0.1:${port}`);
    });
}

module.exports = app;
