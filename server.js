const express = require('express');
const multer = require('multer');
const fs = require('fs');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
app.use(express.json()); // Ensure JSON body parsing
app.use(cors()); // Enable CORS

// ✅ Configure Multer to store files in 'uploads' directory
const storage = multer.diskStorage({
    destination: 'uploads/', 
    filename: (req, file, cb) => {
        cb(null, file.originalname); // Keep original file name
    }
});
const upload = multer({ storage });

const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

// ✅ Function to Upload File to Shopify Files API
async function uploadToShopify(filePath) {
    const fileBuffer = fs.readFileSync(filePath);
    const fileBase64 = fileBuffer.toString('base64');

    const query = `
    mutation fileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
          id
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

    const response = await fetch(`https://${SHOPIFY_STORE}/admin/api/2024-01/graphql.json`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json', // ✅ Ensure this header is present
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

    return jsonResponse.data.fileCreate.files[0].id; // ✅ Return file ID instead of previewUrl
}

// ✅ Function to Save Metafield in Order
async function saveMetafield(orderId, fileId) {
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
            type: "single_line_text_field",
            value: fileId // ✅ Save the file ID instead of a URL
        }]
    };

    const response = await fetch(`https://${SHOPIFY_STORE}/admin/api/2024-01/graphql.json`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json', // ✅ Ensure this header is present
            'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN
        },
        body: JSON.stringify({ query, variables })
    });

    const jsonResponse = await response.json();
    
    if (jsonResponse.data.metafieldsSet.userErrors.length > 0) {
        throw new Error(jsonResponse.data.metafieldsSet.userErrors[0].message);
    }
}

// ✅ Upload Route - FIXED
app.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, error: 'No file uploaded.' });
    }
    try {
        const fileId = await uploadToShopify(req.file.path);
        res.json({ success: true, fileId });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ✅ Test Route - To Check Server Status
app.get('/test', (req, res) => {
    res.json({ success: true, message: 'Server is working!' });
});

// ✅ Start the Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
