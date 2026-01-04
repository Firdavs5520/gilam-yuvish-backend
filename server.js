import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// MongoDB
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
    delivered: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const Order = mongoose.model("Order", OrderSchema);

// ROUTES
app.get("/", (req, res) => {
  res.send("Gilam backend ishlayapti 🚀");
});

app.get("/orders", async (req, res) => {
  const orders = await Order.find().sort({ createdAt: -1 });
  res.json(orders);
});

app.post("/orders", async (req, res) => {
  const order = await Order.create(req.body);
  res.json(order);
});

app.delete("/orders/:id", async (req, res) => {
  const deleted = await Order.findByIdAndDelete(req.params.id);
  if (!deleted) return res.status(404).json({ ok: false });
  res.json({ ok: true });
});

app.put("/orders/:id/deliver", async (req, res) => {
  await Order.findByIdAndUpdate(req.params.id, { delivered: true });
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 Backend port:", PORT);
});
