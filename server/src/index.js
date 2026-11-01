require('dotenv').config({ quiet: true });
const { createApp } = require('./app');

const port = Number(process.env.PORT) || 3000;
createApp().listen(port, () => console.log(`Velvet API listening on http://localhost:${port}`));
