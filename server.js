const express = require('express');
const multer = require('multer');
const fs = require('fs');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
app.use(express.json()); 
app.use(cors()); 

// ✅ Multer setup for file uploads
const storage = multer.diskStorage({
    destination: 'uploads/', 
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});
const upload = multer({ storage });

const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_API_VERSION = "2024-01"; // ✅ Ensure consistent API version

// ✅ Upload File to Shopify Files API
async function uploadToShopify(filePath) {
    const fileBuffer = fs.readFileSync(filePath);
    const fileBase64 = fileBuffer.toString('base64');

    const query = `
    mutation fileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
          id  # ✅ Correct field
          alt
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

    const response = await fetch(`https://${process.env.SHOPIFY_STORE}/admin/api/2024-01/graphql.json`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN
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

    return jsonResponse.data.fileCreate.files[0].id; // ✅ Return file ID instead of URL
}


// ✅ Save Metafield in Order
async function saveMetafield(orderId, fileUrl) {
    const query = `
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          id
          value
        }
        userErrors {
          field
          message
        }
      }
    }`;

    const variables = {
        metafields: [{
            ownerId: `gid://shopify/Order/${orderId}`,
            namespace: "custom",
            key: "lpo_file",
            type: "url",
            value: fileUrl
        }]
    };

    const response = await fetch(`https://${SHOPIFY_STORE}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN
        },
        body: JSON.stringify({ query, variables })
    });

    const jsonResponse = await response.json();
    console.log("Metafield API Response:", JSON.stringify(jsonResponse, null, 2)); // ✅ Debugging Log

    if (!jsonResponse.data || !jsonResponse.data.metafieldsSet) {
        throw new Error(`Unexpected API Response: ${JSON.stringify(jsonResponse)}`);
    }

    if (jsonResponse.data.metafieldsSet.userErrors.length > 0) {
        throw new Error(jsonResponse.data.metafieldsSet.userErrors[0].message);
    }
}

// ✅ File Upload Route
app.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, error: 'No file uploaded.' });
    }
    try {
        const fileUrl = await uploadToShopify(req.file.path);
        res.json({ success: true, fileUrl });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ✅ Save Metafield Route
app.post('/save-metafield', async (req, res) => {
    const { orderId, fileUrl } = req.body;
    
    if (!orderId || !fileUrl) {
        return res.status(400).json({ success: false, error: 'Missing orderId or fileUrl.' });
    }

    try {
        await saveMetafield(orderId, fileUrl);
        res.json({ success: true, message: "Metafield saved successfully!" });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ✅ Test Route
app.get('/test', (req, res) => {
    res.json({ success: true, message: 'Server is working!' });
});

// ✅ Start the Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
