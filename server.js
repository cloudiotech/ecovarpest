const cors = require('cors');
app.use(cors());
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
app.use(express.json()); // Ensure JSON body parsing

// ✅ Configure Multer to store files with correct names in 'uploads' directory
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
          url
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

    const response = await fetch(`https://${SHOPIFY_STORE}/admin/api/2023-04/graphql.json`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN
        },
        body: JSON.stringify({ query, variables })
    });

    const jsonResponse = await response.json();
    if (jsonResponse.data.fileCreate.userErrors.length > 0) {
        throw new Error(jsonResponse.data.fileCreate.userErrors[0].message);
    }

    return jsonResponse.data.fileCreate.files[0].url;
}

// ✅ Function to Save Metafield in Order
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
            type: "single_line_text_field",
            value: fileUrl
        }]
    };

    const response = await fetch(`https://${SHOPIFY_STORE}/admin/api/2023-04/graphql.json`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN
        },
        body: JSON.stringify({ query, variables })
    });

    const jsonResponse = await response.json();
    if (jsonResponse.data.metafieldsSet.userErrors.length > 0) {
        throw new Error(jsonResponse.data.metafieldsSet.userErrors[0].message);
    }
}

// ✅ Upload Route
app.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, error: 'No file uploaded.' });
    }
    if (!req.body.orderId) {
        return res.status(400).json({ success: false, error: 'Order ID is required.' });
    }

    try {
        // Upload file to Shopify Files API
        const fileUrl = await uploadToShopify(req.file.path);

        // Save file URL to order metafield
        await saveMetafield(req.body.orderId, fileUrl);

        res.json({ success: true, fileUrl });
    } catch (error) {
        console.error("Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ✅ Start the Server
app.listen(3000, () => {
    console.log('Server running on port 3000');
});
