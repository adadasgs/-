"use strict";
require("dotenv").config();
const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
fs.mkdirSync(DATA_DIR, { recursive: true });
if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET must be set in production");
}
const SESSION_SECRET = process.env.SESSION_SECRET || "local-development-only-change-me";
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "7mb" }));
app.use(express.urlencoded({ extended: true, limit: "7mb" }));
app.use(session({
  store: new SQLiteStore({ db: "sessions.sqlite", dir: DATA_DIR, table: "sessions" }),
  secret: SESSION_SECRET, resave: false, saveUninitialized: false, name: "astokzi.sid",
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 7 * 86400000 }
}));

const db = new Database(path.join(DATA_DIR, "astokzi.sqlite"));
db.pragma("journal_mode = WAL");
db.exec("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL DEFAULT 'Пользователь', balance REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL);"
 + "CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, product_id TEXT NOT NULL, product_name TEXT NOT NULL, quantity INTEGER NOT NULL, unit_price REAL NOT NULL, total REAL NOT NULL, payment_method TEXT NOT NULL, comment TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL);"
 + "CREATE TABLE IF NOT EXISTS topups (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, amount REAL NOT NULL, screenshot TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL);"
 + "CREATE TABLE IF NOT EXISTS reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, username TEXT NOT NULL, rating INTEGER NOT NULL, message TEXT NOT NULL, product TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL);"
 + "CREATE TABLE IF NOT EXISTS admins (id INTEGER PRIMARY KEY AUTOINCREMENT, login TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);"
 + "CREATE TABLE IF NOT EXISTS balance_history (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, amount REAL NOT NULL, description TEXT NOT NULL, created_at TEXT NOT NULL);");

const products = [
 {id:"raketa",name:"RAKETA",category:"vpn",price:300,stars:360,description:"Быстрое подключение"},
 {id:"global",name:"GLOBAL",category:"vpn",price:400,stars:480,description:"Стабильное подключение"},
 {id:"ultra",name:"ULTRA",category:"vpn",price:500,stars:600,description:"Расширенный тариф"},
 {id:"pulse",name:"PULSE",category:"vpn",price:800,stars:960,description:"Высокая производительность"},
 {id:"strong",name:"STRONG",category:"vpn",price:1200,stars:1400,description:"Усиленный тариф"},
 {id:"monster",name:"MONSTER",category:"vpn",price:1800,stars:2100,description:"Максимальный тариф"},
 {id:"optimization",name:"Оптимизация ASTOKZI",category:"service",price:200,stars:240,description:"Оптимизация устройства"}
];
const now = () => new Date().toISOString();
const clean = (v,n=500) => String(v == null ? "" : v).trim().slice(0,n);
function userId(req) {
 if (!req.session.userId) {
  req.session.userId=crypto.randomUUID(); req.session.username="Пользователь";
  db.prepare("INSERT OR IGNORE INTO users(id,username,created_at) VALUES(?,?,?)").run(req.session.userId,req.session.username,now());
 }
 return req.session.userId;
}
function adminOnly(req,res,next) { if(!req.session.adminId) return res.status(401).json({error:"Требуется вход администратора"}); next(); }
if (!db.prepare("SELECT COUNT(*) n FROM admins").get().n) {
 const login=clean(process.env.ADMIN_LOGIN||"astokzi",40), password=process.env.ADMIN_PASSWORD||"astokzi1112";
 db.prepare("INSERT INTO admins(login,password_hash,created_at) VALUES(?,?,?)").run(login,bcrypt.hashSync(password,12),now());
 console.log("Initial admin created:",login);
}

app.get("/api/health",(req,res)=>res.json({ok:true,service:"ASTOKZI"}));
app.get("/api/products",(req,res)=>res.json(products));
app.get("/api/me",(req,res)=>{
 const id=userId(req), user=db.prepare("SELECT id,username,balance FROM users WHERE id=?").get(id);
 const history=db.prepare("SELECT amount,description,created_at FROM balance_history WHERE user_id=? ORDER BY id DESC LIMIT 30").all(id);
 res.json({...user,history});
});
app.get("/api/my-orders",(req,res)=>res.json(db.prepare("SELECT * FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 50").all(userId(req))));
app.post("/api/orders",(req,res)=>{
 const id=userId(req), items=Array.isArray(req.body.items)?req.body.items:[];
 if(!items.length||items.length>30) return res.status(400).json({error:"Корзина пуста или слишком много позиций"});
 const method=["rub","stars"].includes(req.body.paymentMethod)?req.body.paymentMethod:"rub", comment=clean(req.body.comment,500), ids=[];
 const insert=db.prepare("INSERT INTO orders(user_id,product_id,product_name,quantity,unit_price,total,payment_method,comment,status,created_at) VALUES(?,?,?,?,?,?,?,?,'pending',?)");
 try {
  db.transaction(()=>items.forEach(item=>{
   const p=products.find(x=>x.id===clean(item.productId,50)); if(!p) throw new Error("Неизвестный товар");
   const q=Math.max(1,Math.min(99,Math.floor(Number(item.quantity)||1))), price=method==="stars"?p.stars:p.price;
   ids.push(Number(insert.run(id,p.id,p.name,q,price,price*q,method,comment,now()).lastInsertRowid));
  }))();
 } catch(e){return res.status(400).json({error:e.message});}
 res.json({success:true,ids,message:"Заявка создана и ожидает обработки. Онлайн-оплата пока не подключена."});
});
app.post("/api/topups",(req,res)=>{
 const id=userId(req), amount=Number(req.body.amount), image=String(req.body.screenshot||"");
 if(!Number.isFinite(amount)||amount<50||amount>100000) return res.status(400).json({error:"Сумма должна быть от 50 до 100 000 ₽"});
 if(!/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(image)||image.length>6800000) return res.status(400).json({error:"Прикрепите изображение чека до 5 МБ"});
 const r=db.prepare("INSERT INTO topups(user_id,amount,screenshot,status,created_at) VALUES(?,?,?,'pending',?)").run(id,amount,image,now());
 res.json({success:true,id:r.lastInsertRowid,message:"Чек отправлен администратору на ручную проверку."});
});
app.get("/api/reviews",(req,res)=>res.json(db.prepare("SELECT username,rating,message,product,created_at FROM reviews WHERE status='approved' ORDER BY id DESC LIMIT 100").all()));
app.post("/api/reviews",(req,res)=>{
 const id=userId(req), rating=Math.max(1,Math.min(5,Math.floor(Number(req.body.rating)||5))), message=clean(req.body.message,1000);
 if(message.length<3) return res.status(400).json({error:"Напишите отзыв"});
 const u=db.prepare("SELECT username FROM users WHERE id=?").get(id);
 db.prepare("INSERT INTO reviews(user_id,username,rating,message,product,status,created_at) VALUES(?,?,?,?,?,'pending',?)").run(id,u.username,rating,message,clean(req.body.product,100),now());
 res.json({success:true,message:"Отзыв отправлен на модерацию."});
});
app.post("/api/admin/login",(req,res)=>{
 const login=clean(req.body.login,40), password=String(req.body.password||""), a=db.prepare("SELECT * FROM admins WHERE login=?").get(login);
 if(!a||!bcrypt.compareSync(password,a.password_hash)) return res.status(401).json({error:"Неверный логин или пароль"});
 req.session.regenerate(err=>{if(err)return res.status(500).json({error:"Ошибка сессии"});req.session.adminId=a.id;req.session.adminLogin=a.login;res.json({success:true,login:a.login});});
});
app.get("/api/admin/me",adminOnly,(req,res)=>res.json({success:true,login:req.session.adminLogin}));
app.post("/api/admin/logout",adminOnly,(req,res)=>req.session.destroy(()=>res.json({success:true})));
app.post("/api/admin/change-credentials",adminOnly,(req,res)=>{
 const a=db.prepare("SELECT * FROM admins WHERE id=?").get(req.session.adminId);
 if(!a||!bcrypt.compareSync(String(req.body.currentPassword||""),a.password_hash)) return res.status(400).json({error:"Текущий пароль неверен"});
 const login=clean(req.body.newLogin,40), pass=String(req.body.newPassword||"");
 if(!/^[a-zA-Z0-9_.-]{3,40}$/.test(login)||pass.length<8||pass!==String(req.body.confirmPassword||"")) return res.status(400).json({error:"Проверьте новый логин и пароль (минимум 8 символов)"});
 try{db.prepare("UPDATE admins SET login=?,password_hash=? WHERE id=?").run(login,bcrypt.hashSync(pass,12),a.id);req.session.adminLogin=login;res.json({success:true});}
 catch(e){res.status(409).json({error:"Этот логин уже занят"});}
});
app.get("/api/admin/dashboard",adminOnly,(req,res)=>res.json({
 orders:db.prepare("SELECT COUNT(*) n FROM orders").get().n,
 users:db.prepare("SELECT COUNT(*) n FROM users").get().n,
 pendingTopups:db.prepare("SELECT COUNT(*) n FROM topups WHERE status='pending'").get().n,
 reviews:db.prepare("SELECT COUNT(*) n FROM reviews WHERE status='pending'").get().n
}));
app.get("/api/admin/orders",adminOnly,(req,res)=>res.json(db.prepare("SELECT o.*,u.username FROM orders o LEFT JOIN users u ON u.id=o.user_id ORDER BY o.id DESC LIMIT 300").all()));
app.post("/api/admin/orders/:id/status",adminOnly,(req,res)=>{
 if(!["pending","processing","completed","cancelled"].includes(req.body.status)) return res.status(400).json({error:"Недопустимый статус"});
 db.prepare("UPDATE orders SET status=? WHERE id=?").run(req.body.status,Number(req.params.id));res.json({success:true});
});
app.get("/api/admin/users",adminOnly,(req,res)=>res.json(db.prepare("SELECT id,username,balance,created_at FROM users ORDER BY created_at DESC LIMIT 500").all()));
app.post("/api/admin/users/:id/balance",adminOnly,(req,res)=>{
 const amount=Number(req.body.amount);if(!Number.isFinite(amount)||!amount||Math.abs(amount)>1000000)return res.status(400).json({error:"Некорректная сумма"});
 try{db.transaction(()=>{if(!db.prepare("SELECT id FROM users WHERE id=?").get(req.params.id))throw new Error("Пользователь не найден");db.prepare("UPDATE users SET balance=balance+? WHERE id=?").run(amount,req.params.id);db.prepare("INSERT INTO balance_history(user_id,amount,description,created_at) VALUES(?,?,?,?)").run(req.params.id,amount,"Изменение баланса администратором",now());})();res.json({success:true});}
 catch(e){res.status(404).json({error:e.message});}
});
app.get("/api/admin/topups",adminOnly,(req,res)=>res.json(db.prepare("SELECT t.id,t.user_id,t.amount,t.status,t.created_at,u.username FROM topups t LEFT JOIN users u ON u.id=t.user_id ORDER BY t.id DESC LIMIT 300").all()));
app.get("/api/admin/topups/:id/image",adminOnly,(req,res)=>{
 const row=db.prepare("SELECT screenshot FROM topups WHERE id=?").get(Number(req.params.id));if(!row)return res.status(404).end();res.type("text/plain").send(row.screenshot);
});
app.post("/api/admin/topups/:id/status",adminOnly,(req,res)=>{
 const status=req.body.status;if(!["approved","rejected"].includes(status))return res.status(400).json({error:"Недопустимый статус"});
 try{db.transaction(()=>{const t=db.prepare("SELECT * FROM topups WHERE id=?").get(Number(req.params.id));if(!t||t.status!=="pending")throw new Error("Заявка уже обработана или не найдена");db.prepare("UPDATE topups SET status=? WHERE id=?").run(status,t.id);if(status==="approved"){db.prepare("UPDATE users SET balance=balance+? WHERE id=?").run(t.amount,t.user_id);db.prepare("INSERT INTO balance_history(user_id,amount,description,created_at) VALUES(?,?,?,?)").run(t.user_id,t.amount,"Пополнение подтверждено администратором",now());}})();res.json({success:true});}
 catch(e){res.status(400).json({error:e.message});}
});
app.get("/api/admin/reviews",adminOnly,(req,res)=>res.json(db.prepare("SELECT * FROM reviews ORDER BY id DESC LIMIT 300").all()));
app.post("/api/admin/reviews/:id/status",adminOnly,(req,res)=>{
 if(!["approved","rejected"].includes(req.body.status))return res.status(400).json({error:"Недопустимый статус"});
 db.prepare("UPDATE reviews SET status=? WHERE id=?").run(req.body.status,Number(req.params.id));res.json({success:true});
});
app.get("/api/admin/admins",adminOnly,(req,res)=>res.json(db.prepare("SELECT id,login,created_at FROM admins ORDER BY id").all()));
app.post("/api/admin/admins",adminOnly,(req,res)=>{
 const login=clean(req.body.login,40),password=String(req.body.password||"");
 if(!/^[a-zA-Z0-9_.-]{3,40}$/.test(login)||password.length<8)return res.status(400).json({error:"Логин некорректен или пароль короче 8 символов"});
 try{db.prepare("INSERT INTO admins(login,password_hash,created_at) VALUES(?,?,?)").run(login,bcrypt.hashSync(password,12),now());res.json({success:true});}
 catch(e){res.status(409).json({error:"Такой администратор уже существует"});}
});

app.use(express.static(path.join(__dirname,"public")));
app.get("/admin",(req,res)=>res.sendFile(path.join(__dirname,"public","admin.html"),err=>{if(err)res.redirect("/?admin=1");}));
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,"0.0.0.0",()=>console.log("ASTOKZI listening on port "+PORT));
