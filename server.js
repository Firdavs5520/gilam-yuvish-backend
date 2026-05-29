import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const app = express();
const NODE_ENV = process.env.NODE_ENV || "development";
const DEFAULT_PRICE_PER_M2 = Number(process.env.DEFAULT_PRICE_PER_M2 || 15000);
const TOKEN_TTL_MS = Number(process.env.TOKEN_TTL_HOURS || 12) * 60 * 60 * 1000;
const SESSION_SECRET =
  process.env.SESSION_SECRET || (NODE_ENV === "test" ? "test-secret" : "");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

const STATUSES = ["received", "washing", "drying", "ready", "delivered"];
const STATUS_LABELS = {
  received: "Qabul qilindi",
  washing: "Yuvilmoqda",
  drying: "Quritilmoqda",
  ready: "Tayyor",
  delivered: "Yetkazildi",
};

const DEFAULT_SETTINGS = {
  businessName: "ФАБРИКА ЧИСТКИ КОВРОВ",
  addressLine1: "Ул. Буюк Ипак Йули 62А",
  addressLine2: "Ташкент",
  phone: "71 203 82 82",
  logoUrl:
    "https://peculiar-azure-xpdzzqfo3r.edgeone.app/Skrinshot_2026-01-03_175603-removebg-preview.png",
  warningText:
    "Химчистка снимает с себя ответственность за скрытые дефекты изделия, сильный износ и отсутствие маркировки.\nПретензии принимаются только при получении заказа.",
  defaultPricePerM2: DEFAULT_PRICE_PER_M2,
};

const DEFAULT_ALLOWED_ORIGINS = [
  "https://firdavs5520.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
];

function parseOrigins(value) {
  return String(value || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

const configuredOrigins = parseOrigins(
  process.env.CORS_ORIGINS || process.env.CORS_ORIGIN
);
const allowedOrigins = configuredOrigins.length
  ? configuredOrigins
  : DEFAULT_ALLOWED_ORIGINS;
const allowFileOrigin = process.env.ALLOW_FILE_ORIGIN === "true";

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (origin === "null" && allowFileOrigin) return callback(null, true);
      if (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("CORS origin not allowed"));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json({ limit: "100kb" }));

class ValidationError extends Error {
  constructor(errors) {
    super("Validation error");
    this.errors = Array.isArray(errors) ? errors : [errors];
    this.statusCode = 400;
  }
}

const ItemSchema = new mongoose.Schema(
  {
    l: { type: Number, required: true, min: 0 },
    w: { type: Number, required: true, min: 0 },
    price: { type: Number, required: true, min: 0 },
    sum: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const OrderSchema = new mongoose.Schema(
  {
    orderNo: { type: Number, unique: true, sparse: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    phone: { type: String, required: true, trim: true, maxlength: 32 },
    address: { type: String, required: true, trim: true, maxlength: 240 },
    items: { type: [ItemSchema], default: [] },
    total: { type: Number, required: true, min: 0 },
    paid: { type: Number, default: 0, min: 0 },
    paymentType: { type: String, enum: ["Naqd", "Karta"], default: "Naqd" },
    status: { type: String, enum: STATUSES, default: "received", index: true },
    delivered: { type: Boolean, default: false },
  },
  { timestamps: true }
);

OrderSchema.index({ createdAt: -1 });
OrderSchema.index({ name: "text", phone: "text", address: "text" });

const CounterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

const SettingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: "main" },
    businessName: { type: String, trim: true, maxlength: 120 },
    addressLine1: { type: String, trim: true, maxlength: 160 },
    addressLine2: { type: String, trim: true, maxlength: 160 },
    phone: { type: String, trim: true, maxlength: 60 },
    logoUrl: { type: String, trim: true, maxlength: 500 },
    warningText: { type: String, trim: true, maxlength: 1000 },
    defaultPricePerM2: { type: Number, min: 0 },
  },
  { timestamps: true }
);

const Order = mongoose.models.Order || mongoose.model("Order", OrderSchema);
const Counter =
  mongoose.models.Counter || mongoose.model("Counter", CounterSchema);
const Settings =
  mongoose.models.Settings || mongoose.model("Settings", SettingsSchema);

function cleanString(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function readNumber(value, field, errors, options = {}) {
  const {
    required = true,
    allowZero = false,
    min = allowZero ? 0 : 0.01,
    max = 1_000_000,
  } = options;

  if (value === undefined || value === null || value === "") {
    if (required) errors.push(`${field} majburiy`);
    return null;
  }

  const number = Number(value);
  if (!Number.isFinite(number)) {
    errors.push(`${field} raqam bo'lishi kerak`);
    return null;
  }

  if (number < min || (!allowZero && number === 0)) {
    errors.push(
      `${field} ${allowZero ? "manfiy bo'lmasin" : "0 dan katta bo'lsin"}`
    );
    return null;
  }

  if (number > max) {
    errors.push(`${field} juda katta`);
    return null;
  }

  return Math.round(number * 100) / 100;
}

function normalizePaymentType(value) {
  const paymentType = cleanString(value, 20).toLowerCase();
  return paymentType.includes("karta") || paymentType === "card"
    ? "Karta"
    : "Naqd";
}

function normalizeStatus(value, fallback = "received") {
  return STATUSES.includes(value) ? value : fallback;
}

function normalizeOrderInput(body = {}) {
  const errors = [];
  const name = cleanString(body.name, 120);
  const phone = cleanString(body.phone, 32);
  const address = cleanString(body.address, 240);
  const digits = phone.replace(/\D/g, "");

  if (name.length < 2) errors.push("Ism majburiy");
  if (!/^998\d{9}$/.test(digits)) {
    errors.push("Telefon +998 formatida bo'lishi kerak");
  }
  if (address.length < 3) errors.push("Manzil majburiy");

  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (!rawItems.length) errors.push("Kamida 1 ta gilam kiriting");
  if (rawItems.length > 100) errors.push("Gilamlar soni juda ko'p");

  const items = rawItems.slice(0, 100).map((item, index) => {
    const l = readNumber(item?.l, `items[${index}].l`, errors, { max: 100 });
    const w = readNumber(item?.w, `items[${index}].w`, errors, { max: 100 });
    const price = readNumber(
      item?.price ?? item?.p ?? DEFAULT_PRICE_PER_M2,
      `items[${index}].price`,
      errors,
      { max: 1_000_000 }
    );

    if (l === null || w === null || price === null) return null;

    return {
      l,
      w,
      price,
      sum: Math.round(l * w * price),
    };
  });

  const validItems = items.filter(Boolean);
  const total = validItems.reduce((sum, item) => sum + item.sum, 0);
  const paid =
    readNumber(body.paid ?? 0, "paid", errors, {
      required: false,
      allowZero: true,
      max: 1_000_000_000,
    }) ?? 0;

  if (total > 0 && paid > total) {
    errors.push("To'langan summa jami summadan katta bo'lmasin");
  }

  if (errors.length) throw new ValidationError(errors);

  return {
    name,
    phone,
    address,
    items: validItems,
    total,
    paid,
    paymentType: normalizePaymentType(body.paymentType),
    status: "received",
    delivered: false,
  };
}

function normalizeSettingsInput(body = {}) {
  const errors = [];
  const defaultPricePerM2 =
    readNumber(body.defaultPricePerM2, "defaultPricePerM2", errors, {
      required: false,
      allowZero: false,
      max: 1_000_000,
    }) ?? DEFAULT_SETTINGS.defaultPricePerM2;

  const settings = {
    businessName: cleanString(body.businessName, 120) || DEFAULT_SETTINGS.businessName,
    addressLine1: cleanString(body.addressLine1, 160) || DEFAULT_SETTINGS.addressLine1,
    addressLine2: cleanString(body.addressLine2, 160) || DEFAULT_SETTINGS.addressLine2,
    phone: cleanString(body.phone, 60) || DEFAULT_SETTINGS.phone,
    logoUrl: cleanString(body.logoUrl, 500) || DEFAULT_SETTINGS.logoUrl,
    warningText: cleanString(body.warningText, 1000) || DEFAULT_SETTINGS.warningText,
    defaultPricePerM2,
  };

  if (!settings.businessName) errors.push("Firma nomi majburiy");
  if (!settings.phone) errors.push("Telefon majburiy");
  if (errors.length) throw new ValidationError(errors);

  return settings;
}

function formatOrderNo(orderNo) {
  return orderNo ? `№${String(orderNo).padStart(6, "0")}` : "";
}

function formatOrder(order) {
  const plain = typeof order.toObject === "function" ? order.toObject() : order;
  const status = normalizeStatus(
    plain.status,
    plain.delivered ? "delivered" : "received"
  );
  const total = Number(plain.total || 0);
  const paid = Number(plain.paid || 0);

  return {
    ...plain,
    status,
    delivered: status === "delivered",
    statusLabel: STATUS_LABELS[status],
    balance: Math.max(total - paid, 0),
    orderNoLabel: formatOrderNo(plain.orderNo),
  };
}

function formatSettings(settings) {
  return {
    ...DEFAULT_SETTINGS,
    ...(typeof settings?.toObject === "function" ? settings.toObject() : settings),
  };
}

function signToken() {
  if (!SESSION_SECRET) throw new Error("SESSION_SECRET is required");
  const payload = { sub: "admin", exp: Date.now() + TOKEN_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(body)
    .digest("base64url");

  return `${body}.${signature}`;
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function verifyToken(token) {
  if (!SESSION_SECRET || !token) return null;
  const [body, signature] = String(token).split(".");
  if (!body || !signature) return null;

  const expected = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(body)
    .digest("base64url");

  if (!timingSafeEqual(signature, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!verifyToken(token)) {
    return res.status(401).json({
      ok: false,
      error: "unauthorized",
      message: "Avval admin parol bilan kiring",
    });
  }

  return next();
}

const loginAttempts = new Map();

function getClientKey(req) {
  return req.ip || req.headers["x-forwarded-for"] || "unknown";
}

function registerFailedLogin(key) {
  const current = loginAttempts.get(key) || { count: 0, lockedUntil: 0 };
  const count = current.count + 1;
  loginAttempts.set(key, {
    count,
    lockedUntil: count >= 5 ? Date.now() + 5 * 60 * 1000 : 0,
  });
}

async function getNextOrderNo() {
  const counter = await Counter.findOneAndUpdate(
    { _id: "orders" },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  ).lean();

  return counter.seq;
}

async function getSettingsDocument() {
  const settings = await Settings.findById("main").lean();
  return formatSettings(settings);
}

function buildOrdersQuery(query = {}) {
  const filter = {};
  const search = cleanString(query.search, 120);
  const status = normalizeStatus(query.status, "");
  const dateFilter = {};

  if (status) filter.status = status;

  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const searchNumber = Number(search.replace(/\D/g, ""));
    filter.$or = [
      { name: { $regex: escaped, $options: "i" } },
      { phone: { $regex: escaped, $options: "i" } },
      { address: { $regex: escaped, $options: "i" } },
    ];

    if (Number.isFinite(searchNumber) && searchNumber > 0) {
      filter.$or.push({ orderNo: searchNumber });
    }
  }

  if (query.from) {
    const from = new Date(query.from);
    if (!Number.isNaN(from.getTime())) dateFilter.$gte = from;
  }
  if (query.to) {
    const to = new Date(query.to);
    if (!Number.isNaN(to.getTime())) {
      to.setHours(23, 59, 59, 999);
      dateFilter.$lte = to;
    }
  }
  if (Object.keys(dateFilter).length) filter.createdAt = dateFilter;

  return filter;
}

async function sendTelegramMessage(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
      }),
    });
  } catch (error) {
    console.error("Telegram notification error:", error.message);
  }
}

function buildOrderMessage(order, prefix = "Yangi buyurtma") {
  const formatted = formatOrder(order);
  return [
    `${prefix}: ${formatted.orderNoLabel || formatted._id}`,
    `Mijoz: ${formatted.name}`,
    `Telefon: ${formatted.phone}`,
    `Jami: ${formatted.total.toLocaleString()} so'm`,
    `To'langan: ${Number(formatted.paid || 0).toLocaleString()} so'm`,
    `Qoldiq: ${Number(formatted.balance || 0).toLocaleString()} so'm`,
    `Holat: ${formatted.statusLabel}`,
  ].join("\n");
}

async function createBackupFile(reason = "scheduled") {
  const backupDir = process.env.BACKUP_DIR;
  if (!backupDir) return null;

  const resolvedDir = path.resolve(backupDir);
  await fs.mkdir(resolvedDir, { recursive: true });

  const orders = (await Order.find().sort({ createdAt: -1 }).lean()).map(formatOrder);
  const settings = await getSettingsDocument();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(resolvedDir, `orders-${stamp}.json`);

  await fs.writeFile(
    filePath,
    JSON.stringify(
      {
        ok: true,
        reason,
        exportedAt: new Date().toISOString(),
        settings,
        orders,
      },
      null,
      2
    )
  );

  return filePath;
}

function setupDailyBackup() {
  if (!process.env.BACKUP_DIR) return;

  setInterval(() => {
    createBackupFile("scheduled").catch((error) => {
      console.error("Backup error:", error.message);
    });
  }, 24 * 60 * 60 * 1000);
}

app.get("/", (req, res) => {
  res.status(200).send("Gilam backend ishlayapti");
});

app.get("/meta", requireAuth, async (req, res, next) => {
  try {
    res.json({
      ok: true,
      statuses: STATUSES.map((value) => ({
        value,
        label: STATUS_LABELS[value],
      })),
      settings: await getSettingsDocument(),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/auth/login", (req, res) => {
  const key = getClientKey(req);
  const attempt = loginAttempts.get(key);

  if (attempt?.lockedUntil && attempt.lockedUntil > Date.now()) {
    return res.status(429).json({
      ok: false,
      error: "too_many_attempts",
      message: "Juda ko'p urinish. 5 daqiqadan keyin qayta urinib ko'ring",
    });
  }

  if (String(req.body?.password || "") !== ADMIN_PASSWORD) {
    registerFailedLogin(key);
    return res.status(401).json({
      ok: false,
      error: "auth_failed",
      message: "Admin parol noto'g'ri",
    });
  }

  loginAttempts.delete(key);
  res.json({
    ok: true,
    token: signToken(),
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
  });
});

app.post("/auth/logout", requireAuth, (req, res) => {
  res.json({ ok: true });
});

app.get("/settings", requireAuth, async (req, res, next) => {
  try {
    res.json(await getSettingsDocument());
  } catch (error) {
    next(error);
  }
});

app.put("/settings", requireAuth, async (req, res, next) => {
  try {
    const payload = normalizeSettingsInput(req.body);
    const settings = await Settings.findByIdAndUpdate("main", payload, {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    });

    res.json({ ok: true, settings: formatSettings(settings) });
  } catch (error) {
    next(error);
  }
});

app.get("/orders", requireAuth, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 500, 1000);
    const filter = buildOrdersQuery(req.query);
    let orders = (await Order.find(filter).sort({ createdAt: -1 }).limit(limit).lean()).map(
      formatOrder
    );

    if (req.query.debt === "true") {
      orders = orders.filter((order) => order.balance > 0);
    }

    res.json(orders);
  } catch (error) {
    next(error);
  }
});

app.get("/orders/:id", requireAuth, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ ok: false, message: "ID noto'g'ri" });
    }

    const order = await Order.findById(req.params.id).lean();
    if (!order) return res.status(404).json({ ok: false, message: "Chek topilmadi" });

    return res.json(formatOrder(order));
  } catch (error) {
    return next(error);
  }
});

app.post("/orders", requireAuth, async (req, res, next) => {
  try {
    const payload = normalizeOrderInput(req.body);
    const order = await Order.create({
      ...payload,
      orderNo: await getNextOrderNo(),
    });

    const formatted = formatOrder(order);
    await sendTelegramMessage(buildOrderMessage(formatted));
    res.status(201).json({ ok: true, order: formatted });
  } catch (error) {
    next(error);
  }
});

app.patch("/orders/:id/payment", requireAuth, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ ok: false, message: "ID noto'g'ri" });
    }

    const existing = await Order.findById(req.params.id);
    if (!existing) return res.status(404).json({ ok: false, message: "Chek topilmadi" });

    const errors = [];
    const paid = readNumber(req.body?.paid, "paid", errors, {
      allowZero: true,
      max: 1_000_000_000,
    });
    if (paid !== null && paid > existing.total) {
      errors.push("To'langan summa jami summadan katta bo'lmasin");
    }
    if (errors.length) throw new ValidationError(errors);

    existing.paid = paid;
    existing.paymentType = normalizePaymentType(req.body?.paymentType);
    await existing.save();

    res.json({ ok: true, order: formatOrder(existing) });
  } catch (error) {
    next(error);
  }
});

app.put("/orders/:id/status", requireAuth, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ ok: false, message: "ID noto'g'ri" });
    }

    const status = normalizeStatus(req.body?.status, "");
    if (!status) throw new ValidationError("Holat noto'g'ri");

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status, delivered: status === "delivered" },
      { new: true }
    );

    if (!order) return res.status(404).json({ ok: false, message: "Chek topilmadi" });

    const formatted = formatOrder(order);
    if (status === "ready" || status === "delivered") {
      await sendTelegramMessage(buildOrderMessage(formatted, "Holat yangilandi"));
    }

    return res.json({ ok: true, order: formatted });
  } catch (error) {
    return next(error);
  }
});

app.put("/orders/:id/deliver", requireAuth, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ ok: false, message: "ID noto'g'ri" });
    }

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status: "delivered", delivered: true },
      { new: true }
    );

    if (!order) return res.status(404).json({ ok: false, message: "Chek topilmadi" });

    const formatted = formatOrder(order);
    await sendTelegramMessage(buildOrderMessage(formatted, "Yetkazildi"));
    return res.json({ ok: true, order: formatted });
  } catch (error) {
    return next(error);
  }
});

app.delete("/orders/:id", requireAuth, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ ok: false, message: "ID noto'g'ri" });
    }

    const orderId = req.params.id;
    const deleted = await Order.findByIdAndDelete(orderId);
    if (!deleted) return res.status(404).json({ ok: false, message: "Chek topilmadi" });

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

app.get("/backup/orders.json", requireAuth, async (req, res, next) => {
  try {
    const orders = (await Order.find().sort({ createdAt: -1 }).lean()).map(formatOrder);
    const payload = {
      ok: true,
      exportedAt: new Date().toISOString(),
      settings: await getSettingsDocument(),
      orders,
    };

    if (req.query.save === "true") {
      payload.savedTo = await createBackupFile("manual");
    }

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=gilam-orders-backup.json");
    res.send(JSON.stringify(payload, null, 2));
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  if (error.message === "CORS origin not allowed") {
    return res.status(403).json({
      ok: false,
      error: "origin_not_allowed",
      message: "Bu frontend domeniga ruxsat berilmagan",
    });
  }

  if (error instanceof ValidationError) {
    return res.status(error.statusCode).json({
      ok: false,
      error: "validation_error",
      message: error.errors.join(". "),
      errors: error.errors,
    });
  }

  console.error("Server error:", error.message);
  return res.status(500).json({ ok: false, error: "server_error" });
});

function assertRuntimeConfig() {
  const missing = [];
  if (!process.env.MONGO_URL) missing.push("MONGO_URL");
  if (!ADMIN_PASSWORD) missing.push("ADMIN_PASSWORD");
  if (!SESSION_SECRET) missing.push("SESSION_SECRET");

  if (missing.length) {
    throw new Error(`Missing required env: ${missing.join(", ")}`);
  }
}

function setupKeepAlive() {
  const selfUrl = process.env.SELF_URL;
  if (NODE_ENV !== "production" || !selfUrl) return;

  setInterval(() => {
    fetch(selfUrl)
      .then(() => console.log("keep-alive ping"))
      .catch(() => {});
  }, 4 * 60 * 1000);
}

async function start() {
  assertRuntimeConfig();

  await mongoose.connect(process.env.MONGO_URL, {
    serverSelectionTimeoutMS: 5000,
  });

  console.log("MongoDB connected");

  mongoose.connection.on("error", (error) => {
    console.error("Mongo runtime error:", error.message);
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log("Backend port:", PORT);
  });

  setupKeepAlive();
  setupDailyBackup();
}

if (NODE_ENV !== "test") {
  start().catch((error) => {
    console.error("Startup error:", error.message);
    process.exit(1);
  });
}

export {
  app,
  formatOrder,
  normalizeOrderInput,
  normalizeSettingsInput,
  signToken,
  verifyToken,
};
