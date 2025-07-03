require("dotenv").config();
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.Stripe_key);
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

const serviceAccount = require("./ma-shift-firebase-key.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

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
let usersCollection;
let trackingCollection;
let ridersCollection;
async function run() {
  try {
    // await client.connect();
    const db = client.db("parcelDB");
    usersCollection = db.collection("users");
    parcelCollection = db.collection("parcels");
    paymentsCollection = db.collection("payments");
    trackingCollection = db.collection("tracking");
    ridersCollection = db.collection("riders");
    // await db.command({ ping: 1 });
    console.log("✅ Connected to MongoDB!");
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
  }
}
run().catch(console.dir);

// Custom Middleware

const verifyFbToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  // verify the Token
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.decoded = decoded;
    next();
  } catch (error) {
    return res.status(403).send({ message: "forbidden access" });
  }
};

// Root route
app.get("/", (req, res) => {
  res.send("Parcel Delivery Server is Running");
});

// ----------------------- User Section Code -----------------------------

// user
app.post("/users", async (req, res) => {
  const email = req.body.email;
  const userExists = await usersCollection.findOne({ email });

  if (userExists) {
    // Update last_login field
    await usersCollection.updateOne(
      { email },
      { $set: { last_login: new Date().toISOString() } }
    );

    return res.status(200).send({
      message: "User already exists. Updated last_login.",
      inserted: false,
    });
  }

  // New user case
  const user = {
    ...req.body,
    created_at: new Date(),
    last_login: new Date(),
  };

  const result = await usersCollection.insertOne(user);
  res.send(result);
});

// Get user by Email
app.get("/users/email/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const user = await usersCollection.findOne({ email });
    if (!user) {
      return res.status(404).send({ message: "User not found" });
    }
    res.send(user);
  } catch (error) {
    res
      .status(500)
      .send({ message: "Failed to fetch user", error: error.message });
  }
});
// Make Admin
app.patch("/users/admin/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const result = await usersCollection.updateOne(
      { email },
      { $set: { role: "admin" } }
    );
    res.send(result);
  } catch (error) {
    res
      .status(500)
      .send({ message: "Failed to make admin", error: error.message });
  }
});
// Remove Admin
app.patch("/users/remove-admin/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const result = await usersCollection.updateOne(
      { email },
      { $set: { role: "user" } }
    );
    res.send(result);
  } catch (error) {
    res
      .status(500)
      .send({ message: "Failed to remove admin", error: error.message });
  }
});

// ------------------------ Parcel Section Code -------------------------------------

// Get all parcels or by user email
app.get("/parcels", async (req, res) => {
  try {
    const { email } = req.query;
    const filter = email ? { created_by: email } : {};
    const parcels = await parcelCollection
      .find(filter)
      .sort({ creation_date: -1 })
      .toArray();
    res.send(parcels);
  } catch (error) {
    console.error("❌ Error fetching parcels:", error);
    res
      .status(500)
      .send({ message: "Failed to fetch parcels", error: error.message });
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
    res
      .status(500)
      .send({ message: "Failed to get parcel", error: err.message });
  }
});

// Add a new parcel
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

// ----------------------------- Rider Section Code -----------------------------------------

// riders
app.post("/riders", async (req, res) => {
  try {
    const rider = req.body;
    const result = await ridersCollection.insertOne(rider);
    res.send(result);
  } catch (error) {
    res
      .status(500)
      .send({ error: "Failed to add rider", details: error.message });
  }
});
//  Pending Riders
app.get("/riders/pending", async (req, res) => {
  try {
    const pendingRiders = await ridersCollection
      .find({ status: "pending" })
      .sort({ createdAt: -1 })
      .toArray();

    res.send(pendingRiders);
  } catch (error) {
    res.status(500).send({
      message: "Failed to fetch pending riders",
      error: error.message,
    });
  }
});
// Rider Application Approve
app.patch("/riders/approve/:id", async (req, res) => {
  try {
    const id = req.params.id;

    // First update rider status
    const riderResult = await ridersCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: "approved" } }
    );

    // Get the rider info to update user's role
    const rider = await ridersCollection.findOne({ _id: new ObjectId(id) });

    if (rider?.email) {
      // Update user's role to "rider"
      await usersCollection.updateOne(
        { email: rider.email },
        { $set: { role: "rider" } }
      );
    }

    res.send({
      success: true,
      message: "Rider approved & role updated",
      riderResult,
    });
  } catch (error) {
    res.status(500).send({
      message: "Failed to approve rider or update role",
      error: error.message,
    });
  }
});
// Cancel Rider Application
app.delete("/riders/cancel/:id", async (req, res) => {
  const id = req.params.id;
  const result = await ridersCollection.deleteOne({ _id: new ObjectId(id) });
  res.send(result);
});
// Active Riders (status: approved)
app.get("/riders/active", async (req, res) => {
  try {
    const approvedRiders = await ridersCollection
      .find({ status: "approved" })
      .sort({ created_at: -1 }) // Optional: newest first
      .toArray();

    res.send(approvedRiders);
  } catch (error) {
    res.status(500).send({
      message: "Failed to fetch approved riders",
      error: error.message,
    });
  }
});
// Deactivate an approved rider
app.patch("/riders/deactivate/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const result = await ridersCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: "inactive" } }
    );

    res.send(result);
  } catch (error) {
    res.status(500).send({
      message: "Failed to deactivate rider",
      error: error.message,
    });
  }
});

// --------------------------- Tracking Section -----------------------------

app.post("/tracking", async (req, res) => {
  const { trackingId, parcelId, status, location } = req.body;

  if (!trackingId || !parcelId || !status) {
    return res
      .status(400)
      .send({ error: "trackingId, parcelId, and status are required." });
  }

  const trackingEntry = {
    trackingId,
    parcelId,
    status,
    location: location || "Unknown",
    timestamp: new Date().toISOString(),
  };

  const result = await trackingCollection.insertOne(trackingEntry);
  res.send({ success: true, insertedId: result.insertedId });
});

// ---------------------- Stripe Code -----------------------------------

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

// -------------------------- Payment Section Code --------------------------------

// Get payment history (by user)
app.get("/payments", verifyFbToken, async (req, res) => {
  try {
    const email = req.query.email;

    // Check if the decoded email matches the query email
    if (req.decoded.email !== email) {
      return res.status(403).send({ message: "Forbidden access" });
    }

    const filter = email ? { email } : {};
    const payments = await paymentsCollection
      .find(filter)
      .sort({ paid_at: -1 })
      .toArray();

    res.send(payments);
  } catch (err) {
    res
      .status(500)
      .send({ message: "Failed to fetch payments", error: err.message });
  }
});

// Record payment after success
app.post("/payments", async (req, res) => {
  try {
    const { parcelId, transactionId, email, amount } = req.body;

    if (!parcelId || !transactionId || !email || !amount) {
      return res
        .status(400)
        .send({ error: "Missing required payment fields." });
    }

    const updateResult = await parcelCollection.updateOne(
      { _id: new ObjectId(parcelId) },
      { $set: { status: "Paid", payment_status: "Paid", transactionId } }
    );

    if (updateResult.modifiedCount === 0) {
      return res
        .status(404)
        .send({ error: "Parcel not found or already paid." });
    }

    const parcel = await parcelCollection.findOne({
      _id: new ObjectId(parcelId),
    });

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
    res
      .status(500)
      .send({ error: "Payment processing failed", details: err.message });
  }
});

// Start server
app.listen(port, () => {
  console.log(`🚀 Server is running on port ${port}`);
});
