# NOSTR Indexer Database

This folder contains the database utilities for the NOSTR indexer, designed to work with Turso DB for Vercel deployment.

## 🚀 Features

- **Turso DB Integration**: Full support for Turso's distributed SQLite database
- **Profile Management**: Store and retrieve NOSTR profiles with pictures, banners, and metadata
- **Relationship Tracking**: Manage following/followers relationships
- **Advanced Search**: Full-text search with indexing and suggestions
- **Migration System**: Automated schema management and updates
- **Performance Optimized**: Efficient queries with proper indexing
- **Vercel Ready**: Designed for serverless deployment

## 📁 Structure

```
db/
├── index.js                 # Main database manager
├── migration-manager.js     # Schema and migration management
├── profile-manager.js       # Profile CRUD operations
├── relationship-manager.js  # Relationship management
├── search-manager.js        # Search and indexing
├── utils.js                 # Utility functions
├── migrate.js               # Migration script
├── package.json             # Dependencies
└── README.md               # This file
```

## 🛠️ Setup

### 1. Install Dependencies

```bash
cd db
npm install
```

### 2. Environment Variables

Create a `.env` file in the root directory:

```env
TURSO_DATABASE_URL=libsql://your-database-url.turso.io
TURSO_AUTH_TOKEN=your-auth-token
```

### 3. Run Migrations

```bash
node migrate.js
```

## 📊 Database Schema

### Profiles Table
```sql
CREATE TABLE profiles (
  pubkey TEXT PRIMARY KEY,           -- Hex format public key
  npub TEXT NOT NULL,                -- Bech32 npub format
  name TEXT,                         -- Profile name
  display_name TEXT,                 -- Display name
  about TEXT,                        -- About text
  picture TEXT,                      -- Profile picture URL
  banner TEXT,                       -- Banner image URL
  website TEXT,                      -- Website URL
  lud16 TEXT,                        -- Lightning address
  nip05 TEXT,                        -- NIP-05 identifier
  created_at INTEGER NOT NULL,       -- Event creation timestamp
  indexed_at INTEGER NOT NULL,       -- Indexing timestamp
  search_vector TEXT                 -- Full-text search vector
);
```

### Relationships Table
```sql
CREATE TABLE relationships (
  follower_pubkey TEXT NOT NULL,     -- Hex format follower pubkey
  following_pubkey TEXT NOT NULL,    -- Hex format following pubkey
  follower_npub TEXT NOT NULL,       -- Bech32 npub follower
  following_npub TEXT NOT NULL,      -- Bech32 npub following
  relay TEXT,                        -- Preferred relay
  petname TEXT,                      -- Petname for the contact
  created_at INTEGER NOT NULL,       -- Relationship creation timestamp
  indexed_at INTEGER NOT NULL,       -- Indexing timestamp
  PRIMARY KEY (follower_pubkey, following_pubkey)
);
```

### Search Index Table
```sql
CREATE TABLE search_index (
  term TEXT NOT NULL,                -- Search term
  pubkey TEXT NOT NULL,              -- Profile pubkey
  field_type TEXT NOT NULL,          -- Field type (name, about, etc.)
  PRIMARY KEY (term, pubkey, field_type)
);
```

## 🔧 Usage

### Basic Database Operations

```javascript
const { dbManager } = require('./db');

// Initialize database
await dbManager.init();

// Health check
const health = await dbManager.healthCheck();
console.log(health.success ? 'Database healthy' : 'Database error');

// Get statistics
const stats = await dbManager.getStats();
console.log(`Total profiles: ${stats.total_profiles}`);
```

### Profile Operations

```javascript
// Insert/update profile
const profile = {
  pubkey: '02f00fdee05e934563f15b2c8c5c8c5c8c5c8c5c8c5c8c5c8c5c8c5c8c5c8c5',
  name: 'alice',
  display_name: 'Alice',
  about: 'NOSTR enthusiast',
  picture: 'https://example.com/picture.jpg',
  banner: 'https://example.com/banner.jpg'
};

await dbManager.profiles.upsertProfile(profile);

// Get profile by pubkey (hex or npub)
const profile = await dbManager.profiles.getProfile('02f00fdee05e934563f15b2c8c5c8c5c8c5c8c5c8c5c8c5c8c5c8c5c8c5c8c5');
const profile2 = await dbManager.profiles.getProfile('npub1alice...');

// Search profiles
const results = await dbManager.profiles.searchProfiles('alice', 0, 20);
```

### Relationship Operations

```javascript
// Insert relationship
const relationship = {
  follower_pubkey: '02f00fdee05e934563f15b2c8c5c8c5c8c5c8c5c8c5c8c5c8c5c8c5c8c5c8c5',
  following_pubkey: '03bob...',
  relay: 'wss://relay.damus.io'
};

await dbManager.relationships.upsertRelationship(relationship);

// Get following list
const following = await dbManager.relationships.getFollowing('02f00fdee05e934563f15b2c8c5c8c5c8c5c8c5c8c5c8c5c8c5c8c5c8c5c8c5', 100);

// Get followers list
const followers = await dbManager.relationships.getFollowers('02f00fdee05e934563f15b2c8c5c8c5c8c5c8c5c8c5c8c5c8c5c8c5c8c5c8c5', 100);

// Get relationship stats
const stats = await dbManager.relationships.getRelationshipStats('02f00fdee05e934563f15b2c8c5c8c5c8c5c8c5c8c5c8c5c8c5c8c5c8c5c8c5');
```

### Search Operations

```javascript
// Advanced search with filters
const results = await dbManager.search.searchProfiles('alice', {
  page: 0,
  perPage: 20,
  sortBy: 'created_at',
  sortOrder: 'DESC',
  filters: {
    hasPicture: true,
    hasBanner: true,
    hasNip05: true
  }
});

// Get search suggestions
const suggestions = await dbManager.search.getSearchSuggestions('al', 10);

// Get popular search terms
const popularTerms = await dbManager.search.getPopularSearchTerms(20);
```

## 🚀 Migration Commands

### Run Migrations
```bash
node migrate.js
# or
node migrate.js migrate
```

### Show Statistics
```bash
node migrate.js stats
```

### Health Check
```bash
node migrate.js health
```

### Reset Database (⚠️ Dangerous)
```bash
node migrate.js reset
```

## 🔒 Security Features

- **SQL Injection Protection**: All queries use parameterized statements
- **Input Validation**: Comprehensive validation for all inputs
- **Pubkey Validation**: Validates both hex and npub formats
- **Data Sanitization**: Cleans and validates all data before storage

## 📈 Performance Features

- **Optimized Indexes**: Database indexes for fast queries
- **Connection Pooling**: Efficient connection management
- **Search Indexing**: Full-text search with term indexing
- **Pagination**: Efficient pagination for large datasets
- **Caching**: In-memory caching for frequently accessed data

## 🌐 Vercel Deployment

### Environment Variables for Vercel

Set these in your Vercel project settings:

```env
TURSO_DATABASE_URL=libsql://your-database-url.turso.io
TURSO_AUTH_TOKEN=your-auth-token
```

### API Integration

The database utilities are designed to work seamlessly with Vercel serverless functions:

```javascript
// In your API route
const { dbManager } = require('../db');

export default async function handler(req, res) {
  try {
    await dbManager.init();
    
    if (req.method === 'GET') {
      const profiles = await dbManager.profiles.searchProfiles(req.query.q, 0, 20);
      res.json({ success: true, data: profiles });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}
```

## 🔧 Development

### Running Tests
```bash
npm test
```

### Adding New Features

1. Create new manager class in appropriate file
2. Add methods to the main `DatabaseManager` class
3. Update migration manager if schema changes needed
4. Add tests for new functionality
5. Update documentation

### Database Schema Changes

1. Add migration in `migration-manager.js`
2. Update relevant manager classes
3. Test with `node migrate.js`
4. Update documentation

## 📚 API Reference

### DatabaseManager

- `init()` - Initialize database and run migrations
- `healthCheck()` - Check database connectivity
- `getStats()` - Get database statistics
- `close()` - Close database connection

### ProfileManager

- `upsertProfile(profile)` - Insert or update profile
- `getProfile(pubkey)` - Get profile by pubkey
- `searchProfiles(query, page, perPage)` - Search profiles
- `deleteProfile(pubkey)` - Delete profile
- `getProfileStats()` - Get profile statistics

### RelationshipManager

- `upsertRelationship(relationship)` - Insert or update relationship
- `getFollowing(pubkey, limit)` - Get following list
- `getFollowers(pubkey, limit)` - Get followers list
- `getRelationshipStats(pubkey)` - Get relationship statistics
- `getMutualFollowers(pubkey, limit)` - Get mutual followers

### SearchManager

- `searchProfiles(query, options)` - Advanced profile search
- `getSearchSuggestions(query, limit)` - Get search suggestions
- `getPopularSearchTerms(limit)` - Get popular search terms
- `buildSearchIndex(pubkey, profile)` - Build search index for profile

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details
