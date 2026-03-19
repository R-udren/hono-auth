# Hono Auth

A modern authentication service built with [Hono](https://hono.dev/) and [Better Auth](https://better-auth.com/), featuring multiple authentication strategies and PostgreSQL database integration.

## Features

- 🔐 **Multiple Authentication Methods**
  - Email & Password
  - OAuth (Google, Discord)
  - Username-based authentication
  - Bearer token authentication
  - JWT token support

- 👥 **User Management**
  - User registration and login
  - Account linking across providers
  - User deletion support
  - Admin role system
  - User banning capabilities

- 🛠️ **Developer Features**
  - Type-safe database operations with Drizzle ORM
  - OpenAPI documentation
  - CORS support
  - Request logging with Pino
  - Hot reload during development

## Tech Stack

- **Framework**: [Hono](https://hono.dev/) - Fast, lightweight web framework
- **Authentication**: [Better Auth](https://better-auth.com/) - Comprehensive auth library
- **Database**: PostgreSQL with [Drizzle ORM](https://orm.drizzle.team/)
- **Runtime**: Bun
- **Logger**: Pino
- **Code Quality**: Oxlint + Oxfmt

## Prerequisites

- [Bun](https://bun.sh/) installed
- PostgreSQL database
- OAuth credentials (optional, for social login)
  - Google Client ID & Secret
  - Discord Client ID & Secret

## Environment Variables

Create a `.env` file in the root directory:

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/dbname

# Azure Database (when AZURE_CLOUD=true)
AZURE_CLOUD=true
AZURE_CLIENT_ID=your_managed_identity_client_id
AZURE_PG_HOST=your-server.postgres.database.azure.com
AZURE_PG_PORT=5432
AZURE_PG_DATABASE=auth-db

# CORS Origins (comma-separated)
ORIGINS=http://localhost:3000,http://localhost:5173

# OAuth Providers (optional but will crash without :))
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
DISCORD_CLIENT_ID=your_discord_client_id
DISCORD_CLIENT_SECRET=your_discord_client_secret

# Environment
NODE_ENV=development
```

## Installation

```bash
bun install
```

## Database Setup

Generate and run database migrations:

```bash
# Generate migration files
bun run db:generate

# Push schema to database
bun run db:push

# Or run migrations
bun run db:migrate
```

### Database Studio

Open Drizzle Studio to manage your database:

```bash
bun run db:studio
```

## Development

Start the development server with hot reload:

```bash
bun run dev
```

The server will start on the default port with hot-reloading enabled.

## API Endpoints

### Authentication

All Better Auth endpoints are available under `/api/auth/*`:

- `POST /api/auth/sign-up/email` - Register with email/password
- `POST /api/auth/sign-in/email` - Sign in with email/password
- `POST /api/auth/sign-out` - Sign out
- `GET /api/auth/session` - Get current session
- And more...

Refer to [Better Auth documentation](https://better-auth.com/docs) for complete API reference.

### Custom Endpoints

- `GET /session` - Get current user session and user data

## Project Structure

```
hono-auth/
├── src/
│   ├── index.ts              # Application entry point
│   ├── lib/
│   │   ├── auth.ts           # Better Auth configuration
│   │   └── db/
│   │       ├── index.ts      # Database connection
│   │       ├── schema.ts     # Database schema exports
│   │       └── auth-schema.ts # Auth tables schema
│   └── middleware/
│       ├── index.ts          # Middleware exports
│       ├── not-found.ts      # 404 handler
│       └── on-error.ts       # Error handler
├── drizzle/                  # Database migrations
├── drizzle.config.ts         # Drizzle configuration
├── package.json
├── tsconfig.json
└── Dockerfile
```

## Database Schema

The project uses the following main tables:

- **user** - User accounts with profile information
- **session** - Active user sessions
- **account** - OAuth provider accounts
- **verification** - Email and other verifications

## Code Quality

```bash
# Run linter
bun run lint

# Fix linting issues
bun run lint:fix

# Format files
bun run format

# Check formatting without writing
bun run format:check
```

## Docker

Build and run with Docker:

```bash
docker build -t hono-auth .
docker run -p 3000:3000 --env-file .env hono-auth
```

## Security Features

- Session-based authentication
- JWT token support
- Bearer token authentication
- Password hashing (handled by Better Auth)
- CSRF protection
- Account linking security
- IP address and user agent tracking
- Token expiration management

## Author

R-udren

## Acknowledgments

- [Hono](https://hono.dev/) - The web framework
- [Better Auth](https://better-auth.com/) - Authentication library
- [Drizzle ORM](https://orm.drizzle.team/) - Database toolkit
