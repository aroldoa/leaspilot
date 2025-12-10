# LeasePilot AI - Setup Instructions

## Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- PostgreSQL database (Neon DB connection string provided)

## Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   The `.env` file is already configured with your Neon DB connection string. Make sure it exists:
   ```
   DATABASE_URL=postgresql://neondb_owner:npg_X9e3JSErbzZd@ep-nameless-bird-a4dfxo7b-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
   JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
   PORT=3000
   NODE_ENV=development
   ```

3. **Start the server:**
   ```bash
   npm start
   ```
   
   Or for development with auto-reload:
   ```bash
   npm run dev
   ```

4. **Open the application:**
   - Open `login.html` in your browser
   - Or navigate to `http://localhost:3000/login.html`
   - Create a new account to get started

## Database Schema

The database schema will be automatically created when you first start the server. It includes:

- **users** - User accounts and authentication
- **properties** - Property listings
- **tenants** - Tenant information
- **transactions** - Financial transactions
- **notifications** - User notifications

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/verify` - Verify token

### Properties
- `GET /api/properties` - Get all properties
- `GET /api/properties/:id` - Get single property
- `POST /api/properties` - Create property
- `PUT /api/properties/:id` - Update property
- `DELETE /api/properties/:id` - Delete property

### Tenants
- `GET /api/tenants` - Get all tenants
- `GET /api/tenants/:id` - Get single tenant
- `POST /api/tenants` - Create tenant
- `PUT /api/tenants/:id` - Update tenant
- `DELETE /api/tenants/:id` - Delete tenant

### Transactions
- `GET /api/transactions` - Get all transactions
- `GET /api/transactions/:id` - Get single transaction
- `POST /api/transactions` - Create transaction
- `PUT /api/transactions/:id` - Update transaction
- `DELETE /api/transactions/:id` - Delete transaction

### Users
- `GET /api/users/me` - Get current user
- `PUT /api/users/me` - Update user profile
- `PUT /api/users/me/password` - Change password
- `DELETE /api/users/me` - Delete account

## Troubleshooting

### Database Connection Issues
- Verify your Neon DB connection string is correct
- Check that your IP is allowed in Neon DB settings
- Ensure SSL mode is properly configured

### Port Already in Use
- Change the PORT in `.env` file
- Or kill the process using port 3000

### CORS Issues
- The server is configured to allow CORS from all origins
- For production, update CORS settings in `server.js`

## Production Deployment

1. Update `.env` with production values
2. Change `JWT_SECRET` to a strong random string
3. Set `NODE_ENV=production`
4. Use a process manager like PM2
5. Set up reverse proxy (nginx)
6. Configure SSL/TLS certificates

