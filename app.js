const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const morgan = require('morgan');
const path = require('path');
const { initDB } = require('./database/db');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(morgan('dev'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/pdfs', express.static(path.join(__dirname, 'pdfs')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'hbc-berriozabal-2026-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 },
}));

app.use(flash());

app.use((req, res, next) => {
  res.locals.usuario = req.session.usuario || null;
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  next();
});

app.use('/', require('./routes/auth'));
app.use('/correspondencia', require('./routes/correspondencia'));
app.use('/dashboard', require('./routes/dashboard'));

app.get('/', (req, res) => {
  if (req.session.usuario) return res.redirect('/dashboard');
  res.redirect('/login');
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Error interno del servidor: ' + err.message);
});

initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\nHospital Básico Comunitario — Sistema CRM`);
      console.log(`Servidor corriendo en http://localhost:${PORT}`);
      console.log(`Usuario inicial: admin / Admin2026\n`);
    });
  })
  .catch(err => {
    console.error('Error al conectar con la base de datos:', err.message);
    process.exit(1);
  });
