FROM node:18-alpine

# Install Rust and wasm-pack
RUN apk add --no-cache curl build-base python3
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"
RUN cargo install wasm-pack

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY rust/Cargo.toml rust/
COPY rust/src/ rust/src/

# Build Rust WASM module
RUN cd rust && wasm-pack build --target nodejs

# Install Node.js dependencies
RUN npm install

# Copy application code
COPY . .

# Create logs directory
RUN mkdir -p logs

# Expose port
EXPOSE 3000

# Start the application
CMD ["npm", "start"] 