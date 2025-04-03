const express = require('express');
const multer = require('multer');
const fs = require('fs');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// ✅ Configure Multer to store files in 'uploads' directory
const storage = multer.diskStorage({
    destination: 'uploads/',
    filename: (req, file, cb) => {
        cb(null, file.originalname);
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
          preview {
            image { originalSrc }  # ✅ Get File URL
          }
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
            'Accept': 'application/json',
            'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN
        },
        body: JSON.stringify({ query, variables })
    });

    const jsonResponse = await response.json();
    console.log("🔹 Shopify API Response:", JSON.stringify(jsonResponse, null, 2));

    if (!jsonResponse.data || !jsonResponse.data.fileCreate) {
        throw new Error(`🚨 Unexpected API Response: ${JSON.stringify(jsonResponse)}`);
    }

    if (jsonResponse.data.fileCreate.userErrors.length > 0) {
        console.error("❌ Shopify API Error:", jsonResponse.data.fileCreate.userErrors);
        throw new Error(jsonResponse.data.fileCreate.userErrors[0].message);
    }

    const fileUrl = jsonResponse.data.fileCreate.files[0].preview.image.originalSrc;
    console.log("✅ Uploaded File URL:", fileUrl);

    return fileUrl;
}

// ✅ Function to Save Metafield in Order & Customer
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

// ✅ Upload Route - Uploads File & Returns File URL
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

// ✅ Webhook Listener for Order Creation
app.post("/webhook/orders/create", async (req, res) => {
    try {
        const order = req.body;
        const customerId = order.customer?.id;
        const orderId = order.id;
        const lpoFile = order.note_attributes.find(attr => attr.name === "lpo_file")?.value;

        console.log("📦 New Order Received:", orderId, "👤 Customer ID:", customerId, "📁 LPO File:", lpoFile);

        if (lpoFile) {
            // Save LPO File as Order Metafield
            await saveMetafield("Order", orderId, lpoFile);

            // Save LPO File as Customer Metafield (if customer exists)
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

// ✅ Test Route - Check Server Status
app.get('/test', (req, res) => {
    res.json({ success: true, message: 'Server is working!' });
});

// ✅ Start the Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
