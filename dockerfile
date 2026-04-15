# Use Node.js 18
FROM node:18

# Install Python and FFmpeg
RUN apt-get update && apt-get install -y python3 python3-pip ffmpeg

# Install yt-dlp
RUN pip3 install yt-dlp --break-system-packages

# Create app directory
WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of your code
COPY . .

# Expose the port
EXPOSE 3000

# Start the server
CMD [ "node", "server/server.js" ]
