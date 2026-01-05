import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const app = express();

/* ================== MIDDLEWARE ================== */
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "1mb" }));

/* ================== MONGODB ================== */
mongoose
  .connect(process.env.MONGO_URL, {
    serverSelectionTimeoutMS: 5000,
  })
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => {
    console.error("❌ MongoDB connect error:", err.message);
    process.exit(1);
  });

mongoose.connection.on("error", (err) => {
  console.error("❌ Mongo runtime error:", err.message);
});

/* ================== SCHEMA ================== */
const OrderSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    phone: { type: String, default: "" },
    address: { type: String, default: "" },

    items: { type: Array, default: [] },

    total: { type: Number, default: 0 },
    paid: { type: Number, default: 0 },

    paymentType: { type: String, default: "cash" },

    delivered: { type: Boolean, default: false },
  },
  { timestamps: true }
);

OrderSchema.index({ createdAt: -1 });

const Order = mongoose.model("Order", OrderSchema);

/* ================== ROUTES ================== */

// Health check
app.get("/", (req, res) => {
  res.status(200).send("🚀 Gilam backend ishlayapti");
});

/* -------- GET ALL ORDERS -------- */
app.get("/orders", async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 }).limit(300);

    res.json(orders);
  } catch (e) {
    console.error("❌ Orders olishda xato:", e.message);
    res.status(500).json({ ok: false });
  }
});

/* -------- CREATE ORDER (MUHIM) -------- */
app.post("/orders", async (req, res) => {
  try {
    const order = new Order(req.body);

    // ❗ AVVAL SAQLAYMIZ
    await order.save();

    // ❗ KEYIN JAVOB
    res.status(201).json({
      ok: true,
      order, // 👈 FRONTEND SHU BILAN CHEK CHIQARADI
    });
  } catch (e) {
    console.error("❌ Order save error:", e.message);
    res.status(500).json({ ok: false });
  }
});

/* -------- DELETE ORDER -------- */
app.delete("/orders/:id", async (req, res) => {
  try {
    const deleted = await Order.findByIdAndDelete(req.params.id);

    if (!deleted) {
      return res.status(404).json({ ok: false });
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("❌ Delete error:", e.message);
    res.status(500).json({ ok: false });
  }
});

/* -------- MARK AS DELIVERED -------- */
app.put("/orders/:id/deliver", async (req, res) => {
  try {
    await Order.findByIdAndUpdate(req.params.id, {
      delivered: true,
    });

    res.json({ ok: true });
  } catch (e) {
    console.error("❌ Deliver error:", e.message);
    res.status(500).json({ ok: false });
  }
});

/* ================== KEEP ALIVE (RENDER FREE) ================== */
const SELF_URL = "https://gilam-yuvish-backend.onrender.com";

setInterval(() => {
  fetch(SELF_URL)
    .then(() => console.log("🔄 keep-alive ping"))
    .catch(() => {});
}, 4 * 60 * 1000); // 4 daqiqa (eng optimal)

/* ================== START ================== */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 Backend port:", PORT);
});
