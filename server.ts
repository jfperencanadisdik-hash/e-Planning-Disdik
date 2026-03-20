import express from "express";
import { GoogleGenAI } from "@google/genai";
import path from "path";
import { google } from "googleapis";

// In-memory storage for Google Drive tokens (for prototype)
// Removed for serverless compatibility

const app = express();
app.use(express.json());

// Initialize Gemini AI
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Google OAuth2 Client
const getOAuth2Client = (redirectUri: string) => {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );
};

// API Route for Gemini AI
app.post("/api/ai/generate", async (req, res) => {
    try {
      const { prompt, systemInstruction } = req.body;
      
      if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
      }

      const config: any = {};
      if (systemInstruction) {
        config.systemInstruction = systemInstruction;
      }

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: config
      });

      res.json({ text: response.text });
    } catch (error: any) {
      console.error("Gemini API Error:", error);
      res.status(500).json({ error: error.message || "Failed to generate content" });
    }
  });

  // Google Drive OAuth URL Endpoint
  app.get('/api/auth/drive/url', (req, res) => {
    try {
      if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
        return res.status(500).json({ 
          error: "Kredensial Google Drive (Client ID & Secret) belum diatur di Environment Variables." 
        });
      }

      const redirectUri = req.query.redirectUri as string;
      if (!redirectUri) {
        return res.status(400).json({ error: "redirectUri is required" });
      }
      
      const oauth2Client = getOAuth2Client(redirectUri);
      const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: [
          'https://www.googleapis.com/auth/drive.readonly',
          'https://www.googleapis.com/auth/userinfo.email'
        ],
        prompt: 'consent',
        state: redirectUri // Pass redirectUri in state to ensure exact match in callback
      });
      
      res.json({ url });
    } catch (error: any) {
      console.error("Auth URL Error:", error);
      res.status(500).json({ error: "Failed to generate auth URL: " + error.message });
    }
  });

  // Google Drive OAuth Callback Endpoint
  app.get(['/auth/callback', '/auth/callback/'], async (req, res) => {
    try {
      const { code, state } = req.query;
      if (!code) {
        return res.status(400).send("No code provided");
      }

      // Use the redirectUri passed in the state parameter
      const redirectUri = (state as string) || (process.env.APP_URL?.replace(/\/$/, '') + '/auth/callback');

      const oauth2Client = getOAuth2Client(redirectUri);
      const { tokens } = await oauth2Client.getToken(code as string);
      
      oauth2Client.setCredentials(tokens);

      // Get user info to verify email
      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const userInfo = await oauth2.userinfo.get();
      const email = userInfo.data.email;

      res.send(`
        <html>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ 
                  type: 'OAUTH_AUTH_SUCCESS', 
                  email: '${email}',
                  tokens: ${JSON.stringify(tokens)}
                }, '*');
                window.close();
              } else {
                window.location.href = '/';
              }
            </script>
            <p>Authentication successful for ${email}. This window should close automatically.</p>
          </body>
        </html>
      `);
    } catch (error: any) {
      console.error("Callback Error:", error);
      res.status(500).send("Authentication failed: " + error.message);
    }
  });

  // Check Drive Connection Status
  app.get('/api/drive/status', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.json({ connected: false });
    }

    try {
      const tokensStr = authHeader.substring(7);
      const tokens = JSON.parse(tokensStr);
      
      const oauth2Client = getOAuth2Client("http://localhost");
      oauth2Client.setCredentials(tokens);
      
      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const userInfo = await oauth2.userinfo.get();
      
      res.json({ connected: true, email: userInfo.data.email });
    } catch (error) {
      res.json({ connected: false });
    }
  });

  // Fetch Files from Google Drive
  app.get('/api/drive/files', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: "Not connected to Google Drive" });
    }

    try {
      const tokensStr = authHeader.substring(7);
      const tokens = JSON.parse(tokensStr);

      // Dummy redirectUri since we only need to set credentials
      const oauth2Client = getOAuth2Client("http://localhost");
      oauth2Client.setCredentials(tokens);

      const drive = google.drive({ version: 'v3', auth: oauth2Client });
      
      // Fetch recent files
      const response = await drive.files.list({
        pageSize: 10,
        fields: 'nextPageToken, files(id, name, mimeType, size, createdTime, webViewLink)',
        orderBy: 'createdTime desc'
      });

      res.json({ files: response.data.files });
    } catch (error: any) {
      console.error("Drive API Error:", error);
      res.status(500).json({ error: "Failed to fetch files from Google Drive" });
    }
  });

  // Vite middleware for development
  if (!process.env.VERCEL) {
    const PORT = 3000;
    if (process.env.NODE_ENV !== "production") {
      import("vite").then(({ createServer: createViteServer }) => {
        createViteServer({
          server: { middlewareMode: true },
          appType: "spa",
        }).then(vite => {
          app.use(vite.middlewares);
          app.listen(PORT, "0.0.0.0", () => {
            console.log(`Server running on http://localhost:${PORT}`);
          });
        });
      });
    } else {
      const distPath = path.join(process.cwd(), 'dist');
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
      app.listen(PORT, "0.0.0.0", () => {
        console.log(`Server running on http://localhost:${PORT}`);
      });
    }
  }

export default app;
