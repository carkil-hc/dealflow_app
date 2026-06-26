import express from 'express';
import cors from 'cors';
import path from 'path';
import 'dotenv/config';
import { authRouter } from './auth.js';
import { companiesRouter } from './companies.js';
import { ingestRouter } from './ingest.js';
import { reportsRouter } from './reports.js';

const isProd = process.env.NODE_ENV === 'production';

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// API routes
app.use(authRouter);
app.use(companiesRouter);
app.use(ingestRouter);
app.use(reportsRouter);

// Serve the built React app for all non-API routes in production
if (isProd) {
  const distPath = path.join(process.cwd(), 'dist');
  app.use(express.static(distPath));
  app.get('/{*path}', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

const PORT = process.env.PORT ?? 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
