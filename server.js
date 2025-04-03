const express = require('express');
const multer = require('multer');
const fs = require('fs');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// ✅ Configure Multer for file uploads
const storage = multer.diskStorage({
    destination: 'uploads/',
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});
const upload = multer({ storage });

const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

// ✅ Function to Upload File to Shopify Files API (returns File ID)
async function uploadToShopify(filePath) {
    const fileBuffer = fs.readFileSync(filePath);
    const fileBase64 = fileBuffer.toString('base64');

    const query = `
    mutation fileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
          id  # ✅ Get File ID (not URL)
        }
        userErrors {
          field
          message
        }
      }
    }`;

    const variables = {
        files: [{
            originalSource: `data:application/pdf;base64,${fileBase64}`,
            alt: 'LPO File'
        }]
    };

    const response = await fetch(`https://${SHOPIFY_STORE}/admin/api/2024-01/graphql.json`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN
        },
        body: JSON.stringify({ query, variables })
    });

    const jsonResponse = await response.json();
    console.log("Shopify API Response:", JSON.stringify(jsonResponse, null, 2)); // Debugging Log

    if (!jsonResponse.data || !jsonResponse.data.fileCreate) {
        throw new Error(`Unexpected API Response: ${JSON.stringify(jsonResponse)}`);
    }

    if (jsonResponse.data.fileCreate.userErrors.length > 0) {
        throw new Error(jsonResponse.data.fileCreate.userErrors[0].message);
    }

    return jsonResponse.data.fileCreate.files[0].id; // ✅ Return File ID
}

// ✅ Function to Retrieve File URL from Shopify
async function getFileUrl(fileId) {
    const query = `
    query {
      file(id: "${fileId}") {
        ... on GenericFile {
          url  # ✅ Fetch File URL separately
        }
      }
    }`;

    const response = await fetch(`https://${SHOPIFY_STORE}/admin/api/2024-01/graphql.json`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN
        },
        body: JSON.stringify({ query })
    });

    const jsonResponse = await response.json();
    console.log("File URL Response:", JSON.stringify(jsonResponse, null, 2)); // Debugging Log

    if (!jsonResponse.data || !jsonResponse.data.file) {
        throw new Error(`Could not retrieve file URL: ${JSON.stringify(jsonResponse)}`);
    }

    return jsonResponse.data.file.url;
}

// ✅ Upload Route - Handles File Upload & Fetches URL
app.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, error: 'No file uploaded.' });
    }
    try {
        const fileId = await uploadToShopify(req.file.path);
        const fileUrl = await getFileUrl(fileId); // ✅ Fetch File URL
        res.json({ success: true, fileUrl });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ✅ Test Route - Check if Server is Running
app.get('/test', (req, res) => {
    res.json({ success: true, message: 'Server is working!' });
});

// ✅ Start the Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
