import express from "express";
import cors from "cors";
import mongoose from "mongoose";

const app = express();
app.use(cors());
app.use(express.json());

// MongoDB ulanish (Render ENV dan olinadi)
mongoose
  .connect(process.env.MONGO_URL)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB error", err));

// Schema
const OrderSchema = new mongoose.Schema(
  {
    name: String,
    phone: String,
    address: String,
    items: Array,
    total: String,
    paid: Number,
    paymentType: String,
    date: String,
    delivered: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const Order = mongoose.model("Order", OrderSchema);

// Test route
app.get("/", (req, res) => {
  res.send("Gilam backend ishlayapti 🚀");
});

// Buyurtmalar
app.get("/orders", async (req, res) => {
  const orders = await Order.find().sort({ createdAt: -1 });
  res.json(orders);
});

app.post("/orders", async (req, res) => {
  const order = await Order.create(req.body);
  res.json({ ok: true, order });
});

app.put("/orders/:id/deliver", async (req, res) => {
  const result = await Order.findByIdAndUpdate(
    req.params.id,
    { delivered: true },
    { new: true }
  );

  if (!result) return res.status(404).json({ ok: false });
  res.json({ ok: true });
});

// Port
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 Backend port:", PORT);
});
