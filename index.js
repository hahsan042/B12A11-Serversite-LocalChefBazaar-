require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId, ServerApiVersion } = require('mongodb');
const admin = require('firebase-admin');

const port = process.env.PORT || 3000;

// ===== Firebase Admin Initialization =====
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf-8');
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const app = express();

// ===== Middleware =====
app.use(
  cors({
    origin: ['http://localhost:5173'],
    credentials: true,
    optionsSuccessStatus: 200,
  })
);
app.use(express.json());

// ===== JWT Middleware =====
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(' ')[1];
  if (!token) return res.status(401).send({ message: 'Unauthorized Access!' });

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.tokenEmail = decoded.email;
    next();
  } catch (err) {
    return res.status(401).send({ message: 'Unauthorized Access!', err });
  }
};

// ===== MongoDB Client =====
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const db = client.db('localBazarChef');
    const foodCollection = db.collection('add-food');
    const reviewsCollection = db.collection('reviews');
    const favoritesCollection = db.collection('favorites');

    // ===== CREATE FOOD =====
    app.post('/add-food', verifyJWT, async (req, res) => {
      try {
        const foodData = req.body;
        const result = await foodCollection.insertOne(foodData);
        res.send(result);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: 'Failed to create food', err });
      }
    });

    // ===== READ ALL FOODS =====
    app.get('/add-food', async (req, res) => {
      try {
        const foods = await foodCollection.find().toArray();
        res.send(foods);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: 'Failed to fetch foods', err });
      }
    });

    // ===== READ FOOD BY ID =====
    app.get('/add-food/:id', async (req, res) => {
      const { id } = req.params;
      try {
        const food = await foodCollection.findOne({ _id: new ObjectId(id) });
        if (!food) return res.status(404).send({ message: 'Meal not found' });
        res.send(food);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: 'Failed to fetch meal', err });
      }
    });

    // ===== ORDERS API =====
app.post('/orders', verifyJWT, async (req, res) => {
  try {
    const orderData = req.body;

    orderData.orderTime = new Date();
    orderData.orderStatus = 'pending';     // chef accept করবে
    orderData.paymentStatus = 'pending';   // payment এখনো হয়নি

    const ordersCollection = client
      .db('localBazarChef')
      .collection('order_collection');

    const result = await ordersCollection.insertOne(orderData);
    res.send({ success: true, result });
  } catch (err) {
    res.status(500).send({ message: 'Failed to place order' });
  }
});

app.patch('/orders/:id/accept', verifyJWT, async (req, res) => {
  const { id } = req.params;

  const ordersCollection = client
    .db('localBazarChef')
    .collection('order_collection');

  const result = await ordersCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: { orderStatus: 'accepted' } }
  );

  res.send(result);
});
app.patch('/orders/:id/pay', verifyJWT, async (req, res) => {
  const { id } = req.params;

  const ordersCollection = client
    .db('localBazarChef')
    .collection('order_collection');

  const result = await ordersCollection.updateOne(
    { _id: new ObjectId(id) },
    {
      $set: {
        paymentStatus: 'paid',
        paidAt: new Date(),
      },
    }
  );

  res.send(result);
});


// GET orders by user email
app.get('/orders', verifyJWT, async (req, res) => {
  try {
    const email = req.query.email;
    if (email !== req.tokenEmail)
      return res.status(403).send({ message: 'Forbidden' });

    const ordersCollection = client.db('localBazarChef').collection('order_collection');
    const orders = await ordersCollection.find({ userEmail: email }).toArray();
    res.send(orders);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Failed to fetch orders', err });
  }
});


// ===== DELETE ORDER =====
app.delete('/orders/:id', verifyJWT, async (req, res) => {
  const { id } = req.params;

  try {
    const ordersCollection = client.db('localBazarChef').collection('order_collection');

    // Optional: Ensure that only the user who placed the order can delete it
    const order = await ordersCollection.findOne({ _id: new ObjectId(id) });
    if (!order) return res.status(404).send({ message: 'Order not found' });

    // If you want: only allow deletion if user is owner or admin
    if (order.userEmail !== req.tokenEmail) {
      return res.status(403).send({ message: 'Forbidden: You can only cancel your own order' });
    }

    const result = await ordersCollection.deleteOne({ _id: new ObjectId(id) });

    res.send({ success: true, message: 'Order cancelled successfully', result });
  } catch (err) {
    console.error(err);
    res.status(500).send({ success: false, message: 'Failed to delete order', err });
  }
});




    // ===== REVIEWS API =====
    // Add review
app.post('/reviews', verifyJWT, async (req, res) => {
  try {
    const reviewData = req.body;
    reviewData.date = new Date(); // Add current date

    // 1️⃣ Insert review
    const result = await reviewsCollection.insertOne(reviewData);

    // 2️⃣ Update average rating
    const reviews = await reviewsCollection.find({ foodId: reviewData.foodId }).toArray();
  const avgRating =
  reviews.length > 0
    ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
    : 0;


    await foodCollection.updateOne(
      { _id: new ObjectId(reviewData.foodId) },
      { $set: { rating: avgRating } }
    );

    // 3️⃣ Send response
    res.send({ success: true, result, avgRating });
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Failed to submit review', err });
  }
});


    // Get all reviews for a specific meal
    app.get('/reviews/:foodId', async (req, res) => {
      const { foodId } = req.params;
      try {
        const reviews = await reviewsCollection
          .find({ foodId })
          .sort({ date: -1 })
          .toArray();
        res.send(reviews);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: 'Failed to fetch reviews', err });
      }
    });

    // ===== FAVORITES API =====
    app.post('/favorites', verifyJWT, async (req, res) => {
      try {
        const { userEmail, mealId } = req.body;

        // Check if already in favorites
        const exists = await favoritesCollection.findOne({ userEmail, mealId });
        if (exists)
          return res.send({ success: false, message: 'Meal already in favorites' });

        req.body.addedTime = new Date();
        const result = await favoritesCollection.insertOne(req.body);
        res.send({ success: true, result });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: 'Failed to add favorite', err });
      }
    });
    // ===== GET MY INVENTORY =====
app.get('/my-inventory/:email', verifyJWT, async (req, res) => {
  try {
    const { email } = req.params;

    // JWT থেকে verify করা email match কর
    if (email !== req.tokenEmail) {
      return res.status(403).send({ message: 'Forbidden: Cannot access other user inventory' });
    }

    const db = client.db('localBazarChef');
    const foodCollection = db.collection('add-food');

    const meals = await foodCollection.find({ userEmail: email }).toArray();

    res.send(meals);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Failed to fetch inventory', err });
  }
});
app.delete('/add-food/:id', verifyJWT, async (req, res) => {
  const { id } = req.params;
  try {
    const food = await foodCollection.findOne({ _id: new ObjectId(id) });
    if (!food) return res.status(404).send({ message: 'Food not found' });

    const result = await foodCollection.deleteOne({ _id: new ObjectId(id) });
    res.send({ success: true, message: 'Food deleted', result });
  } catch (err) {
    res.status(500).send({ success: false, message: 'Failed to delete food', err });
  }
});

app.patch('/add-food/:id', verifyJWT, async (req, res) => {
  const { id } = req.params;
  const updateData = req.body;
  try {
    const result = await foodCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );
    res.send({ success: true, result });
  } catch (err) {
    res.status(500).send({ success: false, message: 'Failed to update food', err });
  }
});



    // ===== Ping MongoDB =====
    await client.db('admin').command({ ping: 1 });
    console.log('MongoDB connected successfully!');
  } finally {
    // nothing
  }
}

run().catch(console.dir);

// ===== Default Route =====
app.get('/', (req, res) => {
  res.send('Hello from Server...');
});

// ===== Start Server =====
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});


