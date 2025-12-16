

require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
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
  origin: [process.env.CLIENT_DOMAIN],

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
    const usersCollection = db.collection('users');

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
        if (email !== req.tokenEmail) return res.status(403).send({ message: 'Forbidden access' });

        const meals = await foodCollection.find({ userEmail: email }).toArray();
        res.send(meals);
      } catch (err) {
        res.status(500).send({ message: 'Failed to fetch inventory', err });
      }
    });

    // ===== REVIEWS =====
    app.post('/reviews', verifyJWT, async (req, res) => {
      try {
        const reviewData = req.body;
        reviewData.date = new Date();
        const result = await reviewsCollection.insertOne(reviewData);

        const reviews = await reviewsCollection.find({ foodId: reviewData.foodId }).toArray();
        const avgRating = reviews.length > 0 ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length : 0;

        await foodCollection.updateOne(
          { _id: new ObjectId(reviewData.foodId) },
          { $set: { rating: avgRating } }
        );

        res.send({ success: true, result, avgRating });
      } catch (err) {
        res.status(500).send({ message: 'Failed to submit review', err });
      }
    });

    app.get('/reviews/:foodId', async (req, res) => {
      try {
        const reviews = await reviewsCollection.find({ foodId: req.params.foodId }).sort({ date: -1 }).toArray();
        res.send(reviews);
      } catch (err) {
        res.status(500).send({ message: 'Failed to fetch reviews', err });
      }
    });

    app.get('/reviews', verifyJWT, async (req, res) => {
      try {
        const email = req.query.email;
        if (email !== req.tokenEmail) return res.status(403).send({ message: 'Forbidden' });

        const reviews = await reviewsCollection.find({ reviewerEmail: email }).sort({ date: -1 }).toArray();

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

    // ===== UPDATE ORDER STATUS (Cancel/Accept/Deliver) =====
    app.patch('/orders/:id/status', verifyJWT, async (req, res) => {
      try {
        const { id } = req.params;
        const { status } = req.body; // 'cancelled', 'accepted', 'delivered'

        const validStatus = ['accepted','cancelled','delivered'];
        if(!validStatus.includes(status)) return res.status(400).send({message:'Invalid status'});

        const order = await ordersCollection.findOne({_id: new ObjectId(id)});
        if(!order) return res.status(404).send({message:'Order not found'});

        // RULES
        if(['cancelled','delivered'].includes(order.orderStatus)){
          return res.status(400).send({message:'Order already closed'});
        }
        if(status==='delivered' && order.orderStatus!=='accepted'){
          return res.status(400).send({message:'Order must be accepted first'});
        }

        const result = await ordersCollection.updateOne(
          {_id: new ObjectId(id)},
          {$set:{orderStatus:status}}
        );

        res.send({success:true,result});
      } catch (err) {
        res.status(500).send({message:'Failed to update order status', err});
      }
    });

    // ===== PAYMENT =====
    app.patch('/orders/:id/pay', verifyJWT, async (req,res)=>{
      try{
        const {id} = req.params;
        const result = await ordersCollection.updateOne(
          {_id:new ObjectId(id)},
          {$set:{paymentStatus:'paid', paidAt: new Date()}}
        );
        res.send({success:true,result});
      }catch(err){
        res.status(500).send({message:'Failed to update payment', err});
      }
    });

    // ===== DELETE ORDER =====
    app.delete('/orders/:id', verifyJWT, async (req,res)=>{
      try{
        const order = await ordersCollection.findOne({_id:new ObjectId(req.params.id)});
        if(!order) return res.status(404).send({message:'Order not found'});
        if(order.userEmail !== req.tokenEmail) return res.status(403).send({message:'Forbidden'});

        await ordersCollection.deleteOne({_id:new ObjectId(req.params.id)});
        res.send({success:true, message:'Order deleted'});
      }catch(err){
        res.status(500).send({message:'Failed to delete order', err});
      }
    });

    // ===== USERS =====
    app.post('/users', async (req,res)=>{
      try{
        const userData = req.body;
        const existingUser = await usersCollection.findOne({email:userData.email});
        if(existingUser){
          return res.send({success:true, message:'User already exists', user:existingUser});
        }
        const result = await usersCollection.insertOne({
          ...userData,
          role:userData.role || 'user',
          status:userData.status || 'active',
          createdAt:new Date()
        });
        res.send({success:true, insertedId: result.insertedId});
      }catch(err){
        res.status(500).send({success:false,message:'Failed to create user', err});
      }
    });
     app.get('/users', verifyJWT, async (req, res) => {
      try {
        const requester = await usersCollection.findOne({ email: req.tokenEmail });
        if (!requester || requester.role !== 'admin') return res.status(403).send({ message: 'Forbidden' });
        const users = await usersCollection.find().toArray();
        res.send(users);
      } catch (err) {
        res.status(500).send({ message: 'Failed to fetch users', err });
      }
    });


    app.get('/user/role/:email', verifyJWT, async (req,res)=>{
      const email = req.params.email;
      if(email !== req.tokenEmail) return res.status(403).send({message:'Forbidden access'});

      const user = await usersCollection.findOne({email});
      res.send({role: user?.role || 'user'});
    });

    app.patch('/users/:id/role', verifyJWT, async (req, res) => {
      try {
        const { id } = req.params;
        const { role } = req.body;
        if (!role || !['user', 'chef', 'admin'].includes(role)) return res.status(400).send({ message: 'Invalid role' });

        const currentUser = await usersCollection.findOne({ email: req.tokenEmail });
        if (!currentUser || currentUser.role !== 'admin') return res.status(403).send({ message: 'Only admin can update roles' });

        const targetUser = await usersCollection.findOne({ _id: new ObjectId(id) });
        if (!targetUser) return res.status(404).send({ message: 'User not found' });

        await usersCollection.updateOne({ _id: new ObjectId(id) }, { $set: { role } });
        res.send({ success: true, message: `User role updated to ${role}` });
      } catch (err) {
        res.status(500).send({ message: 'Failed to update user role', err });
      }
    });

    app.patch('/users/:id/fraud', verifyJWT, async (req, res) => {
      try {
        const { id } = req.params;
        const user = await usersCollection.findOne({ _id: new ObjectId(id) });
        if (!user) return res.status(404).send({ message: 'User not found' });
        if (user.role === 'admin') return res.status(403).send({ message: 'Cannot mark admin as fraud' });
        if (user.status === 'fraud') return res.status(400).send({ message: 'User already marked as fraud' });

        await usersCollection.updateOne({ _id: new ObjectId(id) }, { $set: { status: 'fraud' } });
        res.send({ success: true, message: 'User marked as fraud' });
      } catch (err) {
        res.status(500).send({ message: 'Failed to update user status', err });
      }
    });

    // ===== CHEF ORDERS =====
    app.get('/chef/orders', verifyJWT, async (req,res)=>{
      try{
        const chefId = req.query.chefId;
        if(!chefId) return res.status(400).send({message:'chefId required'});

        const orders = await ordersCollection.find({chefId}).sort({orderTime:-1}).toArray();
        res.send(orders);
      }catch(err){
        res.status(500).send({message:'Failed to fetch chef orders', err});
      }
    });

    

// app.post('/create-checkout-session', async (req, res) => {
//   try {
//     const paymentInfo = req.body;
//     console.log('Payment info received:', paymentInfo);

//     const session = await stripe.checkout.sessions.create({
//       payment_method_types: ['card'],
//       line_items: [
//         {
//           price_data: {
//             currency: 'usd',
//             product_data: {
//               name: paymentInfo.mealName,
//               images: [paymentInfo.mealImage], // ✅ FIXED
//             },
//             unit_amount: paymentInfo.amount * 100,
//           },
//           quantity: paymentInfo.quantity || 1,
//         },
//       ],
//       customer_email: paymentInfo.customer?.email,
//       mode: 'payment',
//       success_url: `${process.env.CLIENT_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
//       cancel_url: `${process.env.CLIENT_DOMAIN}/dashboard/my-orders`,
//     });

//     res.json({ url: session.url });
//   } catch (err) {
//     console.error('Stripe checkout error:', err);
//     res.status(500).send({ message: err.message });
//   }
// });
// create-checkout-session
app.post('/create-checkout-session', async (req, res) => {
  try {
    const paymentInfo = req.body;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: paymentInfo.mealName,
              images: [paymentInfo.mealImage],
            },
            unit_amount: paymentInfo.amount * 100,
          },
          quantity: paymentInfo.quantity || 1,
        },
      ],
      customer_email: paymentInfo.customer?.email,
      mode: 'payment',
      success_url: `${process.env.CLIENT_DOMAIN}/payment-success?orderId=${paymentInfo.orderId}`, // ✅ orderId path
      cancel_url: `${process.env.CLIENT_DOMAIN}/dashboard/my-orders`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: err.message });
  }
});

//======================






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

