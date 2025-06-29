require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.Stripe_key);
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

// ✅ Global Declarations (IMPORTANT)
let parcelCollection;
let paymentsCollection;

async function run() {
  try {
    await client.connect();
    const db = client.db("parcelDB");
    parcelCollection = db.collection("parcels");
    paymentsCollection = db.collection("payments"); // ✅ assign to global
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

// Get all parcels or by user email
app.get("/parcels", async (req, res) => {
  try {
    const { email } = req.query;
    const filter = email ? { created_by: email } : {};
    const parcels = await parcelCollection.find(filter).sort({ creation_date: -1 }).toArray();
    res.send(parcels);
  } catch (error) {
    console.error("❌ Error fetching parcels:", error);
    res.status(500).send({ message: "Failed to fetch parcels", error: error.message });
  }
});

// Get single parcel
app.get("/parcels/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const parcel = await parcelCollection.findOne({ _id: new ObjectId(id) });
    if (!parcel) return res.status(404).send({ message: "Parcel not found" });
    res.send(parcel);
  } catch (err) {
    res.status(500).send({ message: "Failed to get parcel", error: err.message });
  }
});

// Add a new parcel
app.post("/parcels", async (req, res) => {
  try {
    const parcel = req.body;
    const result = await parcelCollection.insertOne(parcel);
    res.status(201).send({ message: "Parcel added successfully", insertedId: result.insertedId });
  } catch (error) {
    console.error("❌ Error adding parcel:", error);
    res.status(500).send({ message: "Failed to add parcel", error: error.message });
  }
});

// Delete parcel
app.delete("/parcels/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await parcelCollection.deleteOne({ _id: new ObjectId(id) });
    res.send(result);
  } catch (err) {
    res.status(500).send({ message: "Delete failed", error: err.message });
  }
});

// Stripe Payment Intent
app.post("/create-payment-intent", async (req, res) => {
  const amountInCents = req.body.amountInCents;
  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: "usd",
      payment_method_types: ["card"],
    });
    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get payment history (by user)
app.get("/payments", async (req, res) => {
  try {
    const email = req.query.email;
    const filter = email ? { email } : {};
    const payments = await paymentsCollection.find(filter).sort({ paid_at: -1 }).toArray();
    res.send(payments);
  } catch (err) {
    res.status(500).send({ message: "Failed to fetch payments", error: err.message });
  }
});

// Record payment after success
app.post("/payments", async (req, res) => {
  try {
    const { parcelId, transactionId, email, amount } = req.body;

    if (!parcelId || !transactionId || !email || !amount) {
      return res.status(400).send({ error: "Missing required payment fields." });
    }

    const updateResult = await parcelCollection.updateOne(
      { _id: new ObjectId(parcelId) },
      { $set: { status: "Paid", payment_status: "Paid", transactionId } }
    );

    if (updateResult.modifiedCount === 0) {
      return res.status(404).send({ error: "Parcel not found or already paid." });
    }

    const parcel = await parcelCollection.findOne({ _id: new ObjectId(parcelId) });

    const paymentRecord = {
      parcelId,
      trackingId: parcel?.trackingId || "",
      transactionId,
      email,
      amount,
      paid_at: new Date(),
    };

    const insertResult = await paymentsCollection.insertOne(paymentRecord);

    res.send({
      success: true,
      paymentId: insertResult.insertedId,
      message: "Payment recorded and parcel marked as paid.",
    });
  } catch (err) {
    console.error("❌ Payment error:", err);
    res.status(500).send({ error: "Payment processing failed", details: err.message });
  }
});

// Start server
app.listen(port, () => {
  console.log(`🚀 Server is running on port ${port}`);
});
