require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB setup
const client = new MongoClient(process.env.Mongo_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Declare globally
let parcelCollection;

async function run() {
  try {
    await client.connect();
    const db = client.db("parcelDB");
    parcelCollection = db.collection("parcels");
    await db.command({ ping: 1 });
    console.log("✅ Connected to MongoDB!");
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
  }
}
run().catch(console.dir);

// Root route
app.get("/", (req, res) => {
  res.send("Parcel Delivery Server is Running");
});

// GET /parcels OR /parcels?email=user@example.com
app.get("/parcels", async (req, res) => {
  try {
    const { email } = req.query;

    const filter = email ? { created_by: email } : {};

    const parcels = await parcelCollection
      .find(filter)
      .sort({ creation_date: -1 }) // latest first
      .toArray();

    res.send(parcels);
  } catch (error) {
    console.error("❌ Error fetching parcels:", error);
    res
      .status(500)
      .send({ message: "Failed to fetch parcels", error: error.message });
  }
});

// POST /parcels — Add a new parcel
app.post("/parcels", async (req, res) => {
  try {
    const parcel = req.body;
    const result = await parcelCollection.insertOne(parcel);
    res.status(201).send({
      message: "Parcel added successfully",
      insertedId: result.insertedId,
    });
  } catch (error) {
    console.error("❌ Error adding parcel:", error);
    res
      .status(500)
      .send({ message: "Failed to add parcel", error: error.message });
  }
});

// Start server
app.listen(port, () => {
  console.log(`🚀 Server is running on port ${port}`);
});
