require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const cors = require('cors');
require('@shopify/shopify-api/adapters/node');

const { shopifyApi, LATEST_API_VERSION } = require('@shopify/shopify-api');

const app = express();
const port = process.env.PORT || 10000;

app.use(cors());

// Multer setup
const upload = multer({ dest: 'uploads/' });

// Shopify API setup
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: ['write_files', 'write_customers', 'write_metafields'],
  hostName: process.env.SHOPIFY_APP_URL.replace(/^https?:\/\//, ''),
  apiVersion: LATEST_API_VERSION,
  isEmbeddedApp: false,
});

// Upload endpoint
app.post('/upload-lpo', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    console.log('📁 File received:', req.file.originalname);

    const base64 = fs.readFileSync(req.file.path, { encoding: 'base64' });

    // Create session manually
    const session = {
      shop: process.env.SHOPIFY_SHOP,
      accessToken: process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN,
    };

    const client = new shopify.clients.Graphql({ session });

    // Upload file to Shopify
    const uploadResult = await client.query({
      data: {
        query: `
          mutation fileCreate($files: [FileCreateInput!]!) {
            fileCreate(files: $files) {
              files {
                __typename
                ... on GenericFile {
                  id
                  url
                  alt
                  fileStatus
                  createdAt
                }
                ... on MediaImage {
                  id
                  alt
                  fileStatus
                  createdAt
                  image {
                    url
                  }
                }
              }
              userErrors {
                field
                message
              }
            }
          }
        `,
        variables: {
          files: [
            {
              alt: 'LPO Upload',
              contentType: 'FILE',
              originalSource: `data:application/octet-stream;base64,${base64}`,
              filename: req.file.originalname,
            },
          ],
        },
      },
    });

    const uploadedFile = uploadResult.body.data.fileCreate.files[0];

    let fileUrl = '';
    if (uploadedFile.__typename === 'GenericFile') {
      fileUrl = uploadedFile.url;
    } else if (uploadedFile.__typename === 'MediaImage') {
      fileUrl = uploadedFile.image?.url || '';
    }

    console.log('✅ File uploaded to Shopify:', fileUrl);

    if (!fileUrl) {
      throw new Error('File URL not found in response');
    }

    // Save file URL as metafield on customer
    await client.query({
      data: {
        query: `
          mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
              metafields {
                id
                key
                value
              }
              userErrors {
                field
                message
              }
            }
          }
        `,
        variables: {
          metafields: [
            {
              namespace: 'custom',
              key: 'lpo_upload',
              ownerId: `gid://shopify/Customer/${process.env.DEMO_CUSTOMER_ID}`,
              type: 'url',
              value: fileUrl,
            },
          ],
        },
      },
    });

    // Clean up uploaded file from local disk
    fs.unlinkSync(req.file.path);

    return res.json({ success: true, fileUrl });
  } catch (error) {
    console.error('❌ Upload error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(port, () => {
  console.log(`🚀 Server listening on port ${port}`);
});
