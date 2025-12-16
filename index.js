

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
    origin: ['http://localhost:5173'], // FE URL
    credentials: true,
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
  serverApi: { version: ServerApiVersion.v1 },
});

async function run() {
  try {
    const db = client.db('localBazarChef');
    const foodCollection = db.collection('add-food');
    const reviewsCollection = db.collection('reviews');
    const favoritesCollection = db.collection('favorites');
    const ordersCollection = db.collection('order_collection');
    const usersCollection = db.collection('users')
    // ===== FOODS =====
    app.post('/add-food', verifyJWT, async (req, res) => {
      try {
        const foodData = req.body;
        const result = await foodCollection.insertOne(foodData);
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: 'Failed to create food', err });
      }
    });

    app.get('/add-food', async (req, res) => {
      try {
        const foods = await foodCollection.find().toArray();
        res.send(foods);
      } catch (err) {
        res.status(500).send({ message: 'Failed to fetch foods', err });
      }
    });

    app.get('/add-food/:id', async (req, res) => {
      try {
        const food = await foodCollection.findOne({ _id: new ObjectId(req.params.id) });
        if (!food) return res.status(404).send({ message: 'Meal not found' });
        res.send(food);
      } catch (err) {
        res.status(500).send({ message: 'Failed to fetch meal', err });
      }
    });

    app.patch('/add-food/:id', verifyJWT, async (req, res) => {
      try {
        const result = await foodCollection.updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: req.body }
        );
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: 'Failed to update food', err });
      }
    });

    app.delete('/add-food/:id', verifyJWT, async (req, res) => {
      try {
        const result = await foodCollection.deleteOne({ _id: new ObjectId(req.params.id) });
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: 'Failed to delete food', err });
      }
    });

    // ===== MY INVENTORY =====
app.get('/my-inventory/:email', verifyJWT, async (req, res) => {
  try {
    const { email } = req.params;

    // JWT email match check
    if (email !== req.tokenEmail) {
      return res.status(403).send({ message: 'Forbidden access' });
    }

    const meals = await foodCollection.find({ userEmail: email }).toArray();

    res.send(meals);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: 'Failed to fetch inventory' });
  }
});


    // ===== REVIEWS =====
    app.post('/reviews', verifyJWT, async (req, res) => {
      try {
        const reviewData = req.body;
        reviewData.date = new Date();
        const result = await reviewsCollection.insertOne(reviewData);

        // Update average rating
        const reviews = await reviewsCollection.find({ foodId: reviewData.foodId }).toArray();
        const avgRating =
          reviews.length > 0 ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length : 0;

        await foodCollection.updateOne(
          { _id: new ObjectId(reviewData.foodId) },
          { $set: { rating: avgRating } }
        );

        res.send({ success: true, result, avgRating });
      } catch (err) {
        res.status(500).send({ message: 'Failed to submit review', err });
      }
    });

    // Get all reviews for a specific meal
    app.get('/reviews/:foodId', async (req, res) => {
      try {
        const reviews = await reviewsCollection
          .find({ foodId: req.params.foodId })
          .sort({ date: -1 })
          .toArray();
        res.send(reviews);
      } catch (err) {
        res.status(500).send({ message: 'Failed to fetch reviews', err });
      }
    });

    // Get reviews by user email
    app.get('/reviews', verifyJWT, async (req, res) => {
      try {
        const email = req.query.email;
        if (email !== req.tokenEmail) return res.status(403).send({ message: 'Forbidden' });

        const reviews = await reviewsCollection.find({ reviewerEmail: email }).sort({ date: -1 }).toArray();

        // Attach foodName to each review
        const foodIds = reviews.map(r => new ObjectId(r.foodId));
        const foods = await foodCollection.find({ _id: { $in: foodIds } }).toArray();
        const foodMap = {};
        foods.forEach(f => (foodMap[f._id.toString()] = f.foodName));

        const reviewsWithFoodName = reviews.map(r => ({
          ...r,
          foodName: foodMap[r.foodId] || "Unknown Food",
        }));

        res.send(reviewsWithFoodName);
      } catch (err) {
        res.status(500).send({ message: 'Failed to fetch reviews', err });
      }
    });

    // Delete review
    app.delete('/reviews/:id', verifyJWT, async (req, res) => {
      try {
        const review = await reviewsCollection.findOne({ _id: new ObjectId(req.params.id) });
        if (!review) return res.status(404).send({ message: 'Review not found' });
        if (review.reviewerEmail !== req.tokenEmail) return res.status(403).send({ message: 'Forbidden' });

        await reviewsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
        res.send({ success: true, message: 'Review deleted' });
      } catch (err) {
        res.status(500).send({ message: 'Failed to delete review', err });
      }
    });

    // ===== FAVORITES =====
    app.post('/favorites', verifyJWT, async (req, res) => {
      try {
        const { userEmail, mealId } = req.body;
        const exists = await favoritesCollection.findOne({ userEmail, mealId });
        if (exists) return res.send({ success: false, message: 'Meal already in favorites' });

        req.body.addedTime = new Date();
        const result = await favoritesCollection.insertOne(req.body);
        res.send({ success: true, result });
      } catch (err) {
        res.status(500).send({ message: 'Failed to add favorite', err });
      }
    });

    app.get('/favorites', verifyJWT, async (req, res) => {
      try {
        const email = req.query.email;
        if (email !== req.tokenEmail) return res.status(403).send({ message: 'Forbidden' });

        const favorites = await favoritesCollection.find({ userEmail: email }).sort({ addedTime: -1 }).toArray();
        res.send(favorites);
      } catch (err) {
        res.status(500).send({ message: 'Failed to fetch favorites', err });
      }
    });

    app.delete('/favorites/:id', verifyJWT, async (req, res) => {
      try {
        const favorite = await favoritesCollection.findOne({ _id: new ObjectId(req.params.id) });
        if (!favorite) return res.status(404).send({ message: 'Favorite not found' });
        if (favorite.userEmail !== req.tokenEmail) return res.status(403).send({ message: 'Forbidden' });

        await favoritesCollection.deleteOne({ _id: new ObjectId(req.params.id) });
        res.send({ success: true, message: 'Favorite deleted' });
      } catch (err) {
        res.status(500).send({ message: 'Failed to delete favorite', err });
      }
    });

    // ===== ORDERS =====
    app.post('/orders', verifyJWT, async (req, res) => {
      try {
        const orderData = req.body;
        orderData.orderTime = new Date();
        orderData.orderStatus = 'pending';
        orderData.paymentStatus = 'pending';

        const result = await ordersCollection.insertOne(orderData);
        res.send({ success: true, result });
      } catch (err) {
        res.status(500).send({ message: 'Failed to place order', err });
      }
    });

    app.get('/orders', verifyJWT, async (req, res) => {
      try {
        const email = req.query.email;
        if (email !== req.tokenEmail) return res.status(403).send({ message: 'Forbidden' });

        const orders = await ordersCollection.find({ userEmail: email }).toArray();
        res.send(orders);
      } catch (err) {
        res.status(500).send({ message: 'Failed to fetch orders', err });
      }
    });

    app.patch('/orders/:id/accept', verifyJWT, async (req, res) => {
      const { id } = req.params;
      const result = await ordersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { orderStatus: 'accepted' } }
      );
      res.send(result);
    });

    app.patch('/orders/:id/pay', verifyJWT, async (req, res) => {
      const { id } = req.params;
      const result = await ordersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { paymentStatus: 'paid', paidAt: new Date() } }
      );
      res.send(result);
    });

    app.delete('/orders/:id', verifyJWT, async (req, res) => {
      try {
        const order = await ordersCollection.findOne({ _id: new ObjectId(req.params.id) });
        if (!order) return res.status(404).send({ message: 'Order not found' });
        if (order.userEmail !== req.tokenEmail) return res.status(403).send({ message: 'Forbidden' });

        await ordersCollection.deleteOne({ _id: new ObjectId(req.params.id) });
        res.send({ success: true, message: 'Order deleted' });
      } catch (err) {
        res.status(500).send({ message: 'Failed to delete order', err });
      }
    });
    // save or update a user in db
app.post('/users', async (req, res) => {
  try {
    const userData = req.body;

    // check existing user by email
    const existingUser = await usersCollection.findOne({
      email: userData.email,
    });

    if (existingUser) {
      return res.send({
        success: true,
        message: 'User already exists',
        user: existingUser,
      });
    }

    // insert new user
    const result = await usersCollection.insertOne({
      ...userData,
      role: userData.role || 'user',
      status: userData.status || 'active',
      createdAt: new Date(),
    });

    res.send({
      success: true,
      insertedId: result.insertedId,
    });
  } catch (error) {
    res.status(500).send({
      success: false,
      message: 'Failed to create user',
      error,
    });
  }
});

app.get('/user/role/:email', verifyJWT, async (req, res) => {
  const email = req.params.email

  if (email !== req.tokenEmail) {
    return res.status(403).send({ message: 'Forbidden access' })
  }

  const user = await usersCollection.findOne({ email })

  res.send({ role: user?.role || 'user' })
})




    // ===== Ping MongoDB =====
    await client.db('admin').command({ ping: 1 });
    console.log('MongoDB connected successfully!');
  } finally {
    // Nothing
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
