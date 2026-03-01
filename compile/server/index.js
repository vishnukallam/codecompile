const express = require('express');
const path = require('path');
const app = express();

// Serve static files from the React app build folder
app.use(express.static(path.join(__dirname, '../client/build')));

// Simple heartbeat/status endpoint
app.get('/api/status', (req, res) => {
    res.json({ status: 'online', engine: 'Piston API' });
});

// The "catchall" handler: for any request that doesn't
// match one above, send back React's index.html file.
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/build/index.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('Execution engine: Cloud (Piston API)');
});
