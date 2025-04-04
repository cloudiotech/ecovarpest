require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { shopifyApi, LATEST_API_VERSION } = require('@shopify/shopify-api');
const app = express();
const port = process.env.PORT || 3000;

const upload = multer({ dest: 'uploads/' }); // Local upload folder

// Shopify App Auth Setup
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: ['write_customers', 'write_files', 'write_metafields'],
  hostName: process.env.SHOPIFY_APP_URL.replace(/^https?:\/\//, ''),
  apiVersion: LATEST_API_VERSION,
  isEmbeddedApp: false,
});

// Endpoint to receive LPO file
app.post('/upload-lpo', upload.single('file'), async (req, res) => {
  try {
    const session = await shopify.session.customAppSession(process.env.SHOPIFY_SHOP);

    const client = new shopify.clients.Graphql({ session });

    const fs = require('fs');
    const base64 = fs.readFileSync(req.file.path, { encoding: 'base64' });

    // Upload file to Shopify
    const uploadResult = await client.query({
      data: {
        query: `mutation fileCreate($files: [FileCreateInput!]!) {
          fileCreate(files: $files) {
            files {
              alt
              createdAt
              fileStatus
              preview {
                image {
                  originalSrc
                }
              }
              url
            }
            userErrors {
              field
              message
            }
          }
        }`,
        variables: {
          files: [
            {
              alt: "LPO Upload",
              contentType: "FILE",
              originalSource: `data:${req.file.mimetype};base64,${base64}`,
              filename: req.file.originalname,
            },
          ],
        },
      },
    });

    const fileUrl = uploadResult.body.data.fileCreate.files[0].url;

    // Save metafield (Example: customer metafield, change if needed)
    await client.query({
      data: {
        query: `mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields {
              id
              namespace
              key
              value
            }
            userErrors {
              field
              message
            }
          }
        }`,
        variables: {
          metafields: [
            {
              namespace: "custom",
              key: "lpo_upload",
              ownerId: `gid://shopify/Customer/${process.env.DEMO_CUSTOMER_ID}`, // or cart line or checkout
              type: "url",
              value: fileUrl,
            },
          ],
        },
      },
    });

    res.json({ success: true, fileUrl });
  } catch (err) {
    console.error(err);
    res.json({ success: false, error: err.message });
  }
});

app.listen(port, () => {
  console.log(`App listening on port ${port}`);
});
