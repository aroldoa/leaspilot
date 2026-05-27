# LeasePilot AI - Property Management SaaS

A modern, AI-powered property management application built with HTML, CSS, and JavaScript. Manage your properties, tenants, and finances all in one place.

## Features

### 🔐 Authentication
- User login and signup
- Session management with JWT tokens
- Protected routes
- Secure password hashing

### 🏠 Property Management
- View all properties in a beautiful grid layout
- Add new properties with detailed information
- Property detail pages with unit management
- Status tracking (Occupied, Vacant, Maintenance)
- AI-powered pricing insights

### 👥 Tenant Management
- Complete tenant directory
- Add and manage tenant information
- Track lease status and payment history
- Application screening workflow
- Tenant communication tools

### 💰 Financial Management
- Track income and expenses
- Transaction history
- Cash flow visualization
- Revenue analytics
- Export financial reports

### 🤖 AI Insights
- Market pricing recommendations
- Risk alerts for tenant churn
- Portfolio optimization suggestions
- Automated insights dashboard

### ⚙️ Settings
- User profile management
- Notification preferences
- Billing and subscription management
- Account settings

## Getting Started

### Prerequisites
- Node.js (v18 or higher)
- npm or yarn
- PostgreSQL database (Neon DB connection string provided)

### Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the server:**
   ```bash
   npm start
   ```
   
   The server will run on `http://localhost:3000`

3. **Open the application:**
   - Navigate to `http://localhost:3000/login.html`
   - Create a new account to get started

### Usage

1. **Sign Up**: Start at `signup.html` to create your account
2. **Login**: Sign in at `login.html` with your credentials
2. **Dashboard**: View your portfolio overview at `index.html`
3. **Properties**: Manage properties at `properties.html`
4. **Tenants**: Manage tenants at `tenants.html`
5. **Financials**: Track finances at `financials.html`
6. **Settings**: Configure your account at `settings.html`

## File Structure

```
leaspilot/
├── index.html          # Dashboard/Home page
├── login.html          # Login page
├── signup.html         # Signup page
├── properties.html     # Properties listing
├── property-detail.html # Individual property details
├── tenants.html        # Tenants management
├── financials.html     # Financial tracking
├── settings.html       # User settings
├── app.js             # Main application JavaScript
└── README.md          # This file
```

## Technology Stack

### Frontend
- **HTML5**: Structure and semantic markup
- **Tailwind CSS**: Utility-first CSS framework (via CDN)
- **Lucide Icons**: Modern icon library
- **Vanilla JavaScript**: No frameworks, pure JS

### Backend
- **Node.js**: Runtime environment
- **Express**: Web framework
- **PostgreSQL**: Database (Neon DB)
- **JWT**: Authentication tokens
- **bcryptjs**: Password hashing

## Key Features

### Data Persistence
All data is stored in the browser's localStorage, so your information persists between sessions.

### Responsive Design
Fully responsive design that works on desktop, tablet, and mobile devices.

### Modern UI/UX
- Clean, modern interface
- Smooth animations and transitions
- Intuitive navigation
- Accessible design patterns

### Interactive Modals
- Add/Edit properties
- Add/Edit tenants
- Add transactions
- All with form validation

### Toast Notifications
Real-time feedback for user actions with toast notifications.

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

## Data Storage

All data is stored in a PostgreSQL database (Neon DB). This means:
- ✅ Persistent data storage
- ✅ Multi-user support
- ✅ Data security with authentication
- ✅ Scalable architecture
- ✅ Real-time data synchronization

## Future Enhancements

Potential features for future versions:
- Backend API integration
- Cloud data synchronization
- Advanced reporting and analytics
- Document management
- Maintenance request tracking
- Lease document generation
- Email notifications
- Mobile app

## License

© 2024 LeasePilot AI Inc. All rights reserved.

## Support

For issues or questions, please contact support@leasepilotai.com

---

**Built with ❤️ for property managers**

