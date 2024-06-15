
const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const ObjectId = mongoose.Types.ObjectId;
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');



const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(helmet());

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  w: 'majority', 
});

const db = mongoose.connection;

db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', () => {
  console.log('Connected to MongoDB');
});

// Define MongoDB Schema

// Schema for Campaign
const CampaignSchema = new mongoose.Schema({
  id: { type: String, required: true },
  campaignName: { type: String, required: true },
  adType: { type: String, enum: ['popunder', 'directlink'], required: true },
  bidValue: { type: Number, required: true },
  category: { type: String, enum: ['adult', 'mainstream'], required: true },
  destinationUrl: { type: String, required: true },
  campaignBudget: { type: Number, required: true },
  remainingBudget: { type: Number, default: function() {
    return this.campaignBudget;
  } },
});

const Campaign = mongoose.model('Campaign', CampaignSchema);

// Schema for Viewers
const ViewerSchema = new mongoose.Schema({
    ipAddress: { type: String, required: true },
    userAgent: { type: String, required: true },
    latestClicked: { type: Date, default: Date.now },
    numberClick: { type: Number, default: 0 },
    adId: { type: ObjectId, ref: 'Campaign', required: true }
});
  
const Viewer = mongoose.model('Viewer', ViewerSchema);


// Helper Functions 

// Function to get Ip address
const getClientIp = (req) => {
    const ipAddress = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    return ipAddress;
};


// Routes
app.post('/add/campaigns', async (req, res) => {
  try {
    const newCampaign = new Campaign(req.body);
    await newCampaign.save();
    res.status(201).json(newCampaign);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});


app.get('/watchAds', async (req, res) => {
    const { adType, category, minBid} = req.query;
    try {
    //   Finding out the Campaigns of specific adType , category and have bidValue greather than equal to minBid    
      const campaign = await Campaign
        .find({
            $and: [
              { bidValue: { $gte: minBid } },
              {$expr: { $gte: [ "$remainingBudget", "$bidValue" ] }},
              {adType: adType},
              {category: category},
            ]
          })
        .sort({ bidValue: -1 }) // Sorting so that we get highest bidValue Campaigns on top.
        .limit(1)  // Limiting it to 1 document , because we only value the Campaign which have highest bidValue 
        .exec();

    // Checking it if we got the Campaign or not 
      if (!campaign) {
        return res.status(404).json({ message: 'No matching campaign found' });
      }else{

        const ipAddress = getClientIp(req); // Get client's IP address
        const userAgent = req.get('User-Agent'); 

        // Checking it if a new User Viewed a campaign or it is a previous user 
        let isnewViewer = await Viewer
            .findOne({ipAddress: ipAddress, adId: campaign[0]._id })

        if (isnewViewer) {
            // if exisiting user seeing previous ads then increasing numberClick 
            const capture = await Viewer
                .updateOne(
                    { _id: isnewViewer._id },
                    { $inc: { numberClick: +1 } }
                )
            res.redirect(campaign[0].destinationUrl)
        } else {
            // if new user seeing ads then capturing it's response 
        const capture = new Viewer({
            ipAddress: ipAddress,
            userAgent: userAgent,
            latestClicked: new Date(),
            numberClick: 1,
            adId: campaign[0]._id 
        })
        await capture.save();

        await Campaign
            .updateOne(
                { _id: campaign[0]._id },
                { $inc: { remainingBudget: -campaign[0].bidValue } }
            )
            
        res.redirect(campaign[0].destinationUrl)
        }
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Server error' });
    }
});


// For Downloading All Register Campaign
app.get('/allCampaign', async (req, res) => {
    try {
      const documents = await Campaign.find({});
      const jsonContent = JSON.stringify(documents, null, 2);
  
      const filePath = path.join(__dirname, 'Campaign.json');
      fs.writeFileSync(filePath, jsonContent);
  
      res.download(filePath, 'Campaign.json', (err) => {
        if (err) {
          console.error('Error sending file:', err);
          res.status(500).send('Error downloading file');
        } else {
          console.log('File sent successfully');
          fs.unlinkSync(filePath);
        }
      });
    } catch (error) {
      console.error('Error fetching documents:', error);
      res.status(500).send('Error fetching documents');
    }
});

// For Downloading Analytics Campaign
app.get('/campaignAnalytics', async (req, res) => {
    try {
      const documents = await Viewer.find({});
      const jsonContent = JSON.stringify(documents, null, 2);
  
      const filePath = path.join(__dirname, 'CampaignAnalytics.json');
      fs.writeFileSync(filePath, jsonContent);
  
      res.download(filePath, 'CampaignAnalytics.json', (err) => {
        if (err) {
          console.error('Error sending file:', err);
          res.status(500).send('Error downloading file');
        } else {
          console.log('File sent successfully');
          fs.unlinkSync(filePath);
        }
      });
    } catch (error) {
      console.error('Error fetching documents:', error);
      res.status(500).send('Error fetching documents');
    }
});

  

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
