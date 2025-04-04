const express = require('express');
const multer = require('multer');
const fs = require('fs');
const cors = require('cors');
const fetch = require('node-fetch');
const FormData = require('form-data');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET;

// ✅ Configure Multer for File Uploads
const storage = multer.diskStorage({
    destination: 'uploads/',
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});
const upload = multer({ storage });

/** 🔹 Upload File to Shopify Files API (using REST API) */
async function uploadToShopify(filePath) {
    const fileBuffer = fs.readFileSync(filePath);
    const formData = new FormData();
    formData.append('file', fileBuffer, { filename: 'LPO.pdf' });

    const response = await fetch(`https://${SHOPIFY_STORE}/admin/api/2024-01/files.json`, {
        method: 'POST',
        headers: {
            'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN
        },
        body: formData
    });

    // Check if the response status is OK
    if (!response.ok) {
        throw new Error(`Failed to upload file: ${response.statusText}`);
    }

    const jsonResponse = await response.json();

    // Check if the response contains valid JSON
    if (!jsonResponse || jsonResponse.errors) {
        throw new Error(`Upload failed: ${jsonResponse ? JSON.stringify(jsonResponse.errors) : 'Unknown error'}`);
    }

    console.log("🔹 Shopify File Upload Response:", JSON.stringify(jsonResponse, null, 2));
    return jsonResponse.file.src; // URL of the uploaded file
}


/** 🔹 Save Metafield in Shopify (Order / Customer) */
async function saveMetafield(ownerType, ownerId, fileUrl) {
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
            ownerId: `gid://shopify/${ownerType}/${ownerId}`,
            namespace: "custom",
            key: "lpo_file",
            type: "single_line_text_field",
            value: fileUrl
        }]
    };

    const response = await fetch(`https://${SHOPIFY_STORE}/admin/api/2024-01/graphql.json`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN
        },
        body: JSON.stringify({ query, variables })
    });

    const jsonResponse = await response.json();
    console.log(`✅ Metafield Saved for ${ownerType}:`, jsonResponse);

    if (jsonResponse.data.metafieldsSet.userErrors.length > 0) {
        throw new Error(jsonResponse.data.metafieldsSet.userErrors[0].message);
    }
}

/** 🔹 Upload Route */
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

/** 🔹 Verify Shopify Webhook Signature */
function verifyShopifyWebhook(req, res, next) {
    const hmac = req.headers['x-shopify-hmac-sha256']; 
    const body = JSON.stringify(req.body);
    const hash = crypto.createHmac('sha256', SHOPIFY_WEBHOOK_SECRET)
                      .update(body, 'utf8')
                      .digest('base64');

    if (hash !== hmac) {
        console.error("🚨 Webhook verification failed!");
        return res.status(401).send("Unauthorized");
    }
    next();
}

/** 🔹 Webhook Listener for Order Creation */
app.post("/webhook/orders/create", express.json(), verifyShopifyWebhook, async (req, res) => {
    try {
        const order = req.body;
        const customerId = order.customer?.id;
        const orderId = order.id;
        const lpoFile = order.note_attributes.find(attr => attr.name === "lpo_file")?.value;

        console.log("📦 New Order Received:", orderId, "👤 Customer ID:", customerId, "📁 LPO File:", lpoFile);

        if (lpoFile) {
            await saveMetafield("Order", orderId, lpoFile);
            if (customerId) {
                await saveMetafield("Customer", customerId, lpoFile);
            }
        }

        res.status(200).send("✅ LPO Metafields Updated Successfully");
    } catch (error) {
        console.error("❌ Error Updating Metafields:", error);
        res.status(500).send("Failed to update metafields");
    }
});

/** 🔹 Test Route */
app.get('/test', (req, res) => {
    res.json({ success: true, message: 'Server is working!' });
});

/** 🔹 Start the Server */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
