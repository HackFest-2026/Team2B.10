// Auto-generated from code.json
const papers = [
  {
    id: 1,
    slug: "attention-is-all-you-need",
    title: "Attention Is All You Need",
    authors: ["Vaswani et al."],
    year: 2017,
    category: "NLP",
    difficulty: "intermediate",
    arxiv_url: "https://arxiv.org/abs/1706.03762",
    description:
      "Introduces the Transformer architecture built entirely on self-attention, replacing recurrence and convolutions entirely.",
    is_premium: false,
    implementation_steps: [
      {
        step_id: 1,
        title: "Scaled Dot-Product Attention",
        description:
          "Implement the core attention function that computes how much focus each token should place on every other token.",
        objective:
          "Given Q, K, V matrices, compute attention scores and return weighted values.",
        code_snippet: {
          language: "python",
          starter_code:
            'import torch\nimport torch.nn as nn\nimport math\n\ndef scaled_dot_product_attention(Q, K, V, mask=None):\n    # TODO: Compute dot product of Q and K^T\n    # TODO: Scale by sqrt(d_k)\n    # TODO: Apply mask if provided\n    # TODO: Softmax and multiply by V\n    pass',
          solution_code:
            "def scaled_dot_product_attention(Q, K, V, mask=None):\n    d_k = Q.size(-1)\n    scores = torch.matmul(Q, K.transpose(-2, -1)) / math.sqrt(d_k)\n    if mask is not None:\n        scores = scores.masked_fill(mask == 0, -1e9)\n    attn_weights = torch.softmax(scores, dim=-1)\n    return torch.matmul(attn_weights, V), attn_weights",
        },
        hints: [
          "d_k is the dimension of the key vectors — use Q.size(-1) to get it",
          "Use torch.matmul(Q, K.transpose(-2, -1)) for the dot product",
          "Masking should replace 0-positions with a very large negative number like -1e9 before softmax",
          "The scaling factor is sqrt(d_k) to prevent vanishing gradients in softmax",
        ],
        unit_test:
          "Q = torch.rand(2, 4, 64)\nK = torch.rand(2, 4, 64)\nV = torch.rand(2, 4, 64)\noutput, weights = scaled_dot_product_attention(Q, K, V)\nassert output.shape == (2, 4, 64), 'Output shape mismatch'\nassert weights.shape == (2, 4, 4), 'Attention weights shape mismatch'\nassert abs(weights.sum(-1).mean().item() - 1.0) < 1e-5, 'Weights must sum to 1'",
      },
      {
        step_id: 2,
        title: "Multi-Head Attention",
        description:
          "Stack multiple attention heads so the model can jointly attend to information from different representation subspaces.",
        objective:
          "Implement MultiHeadAttention that splits Q, K, V into h heads, runs attention in parallel, then concatenates.",
        code_snippet: {
          language: "python",
          starter_code:
            "class MultiHeadAttention(nn.Module):\n    def __init__(self, d_model, num_heads):\n        super().__init__()\n        self.num_heads = num_heads\n        self.d_k = d_model // num_heads\n        # TODO: Define linear layers for Q, K, V and output\n        pass\n\n    def forward(self, Q, K, V, mask=None):\n        # TODO: Linear project Q, K, V\n        # TODO: Reshape into (batch, heads, seq, d_k)\n        # TODO: Apply scaled_dot_product_attention\n        # TODO: Concatenate heads and project output\n        pass",
          solution_code:
            "class MultiHeadAttention(nn.Module):\n    def __init__(self, d_model, num_heads):\n        super().__init__()\n        self.num_heads = num_heads\n        self.d_k = d_model // num_heads\n        self.W_q = nn.Linear(d_model, d_model)\n        self.W_k = nn.Linear(d_model, d_model)\n        self.W_v = nn.Linear(d_model, d_model)\n        self.W_o = nn.Linear(d_model, d_model)\n\n    def split_heads(self, x, batch_size):\n        x = x.view(batch_size, -1, self.num_heads, self.d_k)\n        return x.transpose(1, 2)\n\n    def forward(self, Q, K, V, mask=None):\n        batch_size = Q.size(0)\n        Q = self.split_heads(self.W_q(Q), batch_size)\n        K = self.split_heads(self.W_k(K), batch_size)\n        V = self.split_heads(self.W_v(V), batch_size)\n        attn_output, _ = scaled_dot_product_attention(Q, K, V, mask)\n        attn_output = attn_output.transpose(1, 2).contiguous().view(batch_size, -1, self.num_heads * self.d_k)\n        return self.W_o(attn_output)",
        },
        hints: [
          "d_model must be divisible by num_heads — d_k = d_model // num_heads",
          "Use .view() and .transpose(1, 2) to reshape into (batch, heads, seq_len, d_k)",
          "After attention, use .contiguous().view() to merge the heads back together",
          "You need 4 linear layers: W_q, W_k, W_v, and W_o for the final output projection",
        ],
        unit_test:
          "mha = MultiHeadAttention(d_model=512, num_heads=8)\nx = torch.rand(2, 10, 512)\noutput = mha(x, x, x)\nassert output.shape == (2, 10, 512), 'Output shape mismatch'",
      },
      {
        step_id: 3,
        title: "Positional Encoding",
        description:
          "Since Transformers have no recurrence, inject position information using sinusoidal functions.",
        objective:
          "Create a PositionalEncoding module that adds position-dependent signals to the input embeddings.",
        code_snippet: {
          language: "python",
          starter_code:
            "class PositionalEncoding(nn.Module):\n    def __init__(self, d_model, max_len=5000):\n        super().__init__()\n        # TODO: Create a (max_len, d_model) matrix of positional encodings\n        # Even indices: sin(pos / 10000^(2i/d_model))\n        # Odd indices:  cos(pos / 10000^(2i/d_model))\n        pass\n\n    def forward(self, x):\n        # TODO: Add positional encoding to x\n        pass",
          solution_code:
            "class PositionalEncoding(nn.Module):\n    def __init__(self, d_model, max_len=5000):\n        super().__init__()\n        pe = torch.zeros(max_len, d_model)\n        position = torch.arange(0, max_len).unsqueeze(1).float()\n        div_term = torch.exp(torch.arange(0, d_model, 2).float() * -(math.log(10000.0) / d_model))\n        pe[:, 0::2] = torch.sin(position * div_term)\n        pe[:, 1::2] = torch.cos(position * div_term)\n        pe = pe.unsqueeze(0)\n        self.register_buffer('pe', pe)\n\n    def forward(self, x):\n        return x + self.pe[:, :x.size(1)]",
        },
        hints: [
          "Use register_buffer so positional encoding moves with the model to GPU but isn't a learnable parameter",
          "Even positions (0, 2, 4...) use sin, odd positions (1, 3, 5...) use cos",
          "The divisor is 10000^(2i/d_model) — compute it as exp(2i * -log(10000) / d_model) for numerical stability",
          "Add a batch dimension with .unsqueeze(0) so it broadcasts over batch size",
        ],
        unit_test:
          "pe = PositionalEncoding(d_model=512)\nx = torch.rand(2, 10, 512)\noutput = pe(x)\nassert output.shape == (2, 10, 512), 'Shape mismatch after positional encoding'",
      },
      {
        step_id: 4,
        title: "Feed-Forward Network",
        description:
          "Add the position-wise feed-forward sublayer applied identically to each position.",
        objective:
          "Implement a 2-layer FFN with ReLU activation and a hidden dimension 4x larger than d_model.",
        code_snippet: {
          language: "python",
          starter_code:
            "class FeedForward(nn.Module):\n    def __init__(self, d_model, d_ff=2048):\n        super().__init__()\n        # TODO: Two linear layers with ReLU in between\n        pass\n\n    def forward(self, x):\n        pass",
          solution_code:
            "class FeedForward(nn.Module):\n    def __init__(self, d_model, d_ff=2048):\n        super().__init__()\n        self.fc1 = nn.Linear(d_model, d_ff)\n        self.fc2 = nn.Linear(d_ff, d_model)\n        self.relu = nn.ReLU()\n\n    def forward(self, x):\n        return self.fc2(self.relu(self.fc1(x)))",
        },
        hints: [
          "The paper uses d_ff = 2048 when d_model = 512 (4x ratio)",
          "Apply ReLU only between the two linear layers, not at the output",
          "This layer is applied independently and identically to each position",
        ],
        unit_test:
          "ff = FeedForward(d_model=512)\nx = torch.rand(2, 10, 512)\nassert ff(x).shape == (2, 10, 512)",
      },
      {
        step_id: 5,
        title: "Encoder Layer",
        description:
          "Combine Multi-Head Attention and Feed-Forward into a single Encoder block with residual connections and LayerNorm.",
        objective:
          "Build one Transformer encoder layer: MHA → Add & Norm → FFN → Add & Norm.",
        code_snippet: {
          language: "python",
          starter_code:
            "class EncoderLayer(nn.Module):\n    def __init__(self, d_model, num_heads, d_ff, dropout=0.1):\n        super().__init__()\n        # TODO: MultiHeadAttention, FeedForward, two LayerNorms, Dropout\n        pass\n\n    def forward(self, x, mask=None):\n        # TODO: Self-attention with residual + norm\n        # TODO: FFN with residual + norm\n        pass",
          solution_code:
            "class EncoderLayer(nn.Module):\n    def __init__(self, d_model, num_heads, d_ff, dropout=0.1):\n        super().__init__()\n        self.self_attn = MultiHeadAttention(d_model, num_heads)\n        self.ff = FeedForward(d_model, d_ff)\n        self.norm1 = nn.LayerNorm(d_model)\n        self.norm2 = nn.LayerNorm(d_model)\n        self.dropout = nn.Dropout(dropout)\n\n    def forward(self, x, mask=None):\n        attn_out = self.self_attn(x, x, x, mask)\n        x = self.norm1(x + self.dropout(attn_out))\n        ff_out = self.ff(x)\n        x = self.norm2(x + self.dropout(ff_out))\n        return x",
        },
        hints: [
          "Residual connection means: x = LayerNorm(x + sublayer(x))",
          "Apply dropout to the output of each sublayer before adding the residual",
          "Q, K, V are all the same tensor x in the encoder (self-attention)",
          "You need two separate LayerNorm instances — one per sublayer",
        ],
        unit_test:
          "layer = EncoderLayer(d_model=512, num_heads=8, d_ff=2048)\nx = torch.rand(2, 10, 512)\nassert layer(x).shape == (2, 10, 512)",
      },
    ],
  },
  {
    id: 2,
    slug: "deep-residual-learning",
    title: "Deep Residual Learning for Image Recognition",
    authors: ["He et al."],
    year: 2015,
    category: "Vision",
    difficulty: "beginner",
    arxiv_url: "https://arxiv.org/abs/1512.03385",
    description:
      "Introduces residual (skip) connections to train very deep networks by learning residual functions.",
    is_premium: false,
    implementation_steps: [
      {
        step_id: 1,
        title: "Basic Residual Block",
        description:
          "Build the core building block of ResNet — two conv layers with a skip connection.",
        objective:
          "Implement a ResidualBlock that adds the input directly to the output of two conv layers.",
        code_snippet: {
          language: "python",
          starter_code:
            "class ResidualBlock(nn.Module):\n    def __init__(self, in_channels, out_channels, stride=1):\n        super().__init__()\n        # TODO: Two 3x3 conv layers with BatchNorm\n        # TODO: Shortcut/skip connection (handle channel mismatch)\n        pass\n\n    def forward(self, x):\n        # TODO: F(x) + x\n        pass",
          solution_code:
            "class ResidualBlock(nn.Module):\n    def __init__(self, in_channels, out_channels, stride=1):\n        super().__init__()\n        self.conv1 = nn.Conv2d(in_channels, out_channels, 3, stride=stride, padding=1, bias=False)\n        self.bn1 = nn.BatchNorm2d(out_channels)\n        self.conv2 = nn.Conv2d(out_channels, out_channels, 3, padding=1, bias=False)\n        self.bn2 = nn.BatchNorm2d(out_channels)\n        self.relu = nn.ReLU(inplace=True)\n        self.shortcut = nn.Sequential()\n        if stride != 1 or in_channels != out_channels:\n            self.shortcut = nn.Sequential(\n                nn.Conv2d(in_channels, out_channels, 1, stride=stride, bias=False),\n                nn.BatchNorm2d(out_channels)\n            )\n\n    def forward(self, x):\n        out = self.relu(self.bn1(self.conv1(x)))\n        out = self.bn2(self.conv2(out))\n        out += self.shortcut(x)\n        return self.relu(out)",
        },
        hints: [
          "The shortcut must match the main path's shape — use a 1x1 conv when stride != 1 or channels differ",
          "Apply ReLU after the addition, not before",
          "Set bias=False when using BatchNorm — BN already handles the bias term",
          "The key formula is: output = F(x) + x, where F is the two conv layers",
        ],
        unit_test:
          "block = ResidualBlock(64, 128, stride=2)\nx = torch.rand(2, 64, 32, 32)\nassert block(x).shape == (2, 128, 16, 16)",
      },
      {
        step_id: 2,
        title: "Stack Residual Layers",
        description:
          "Stack multiple residual blocks into layers to form the full ResNet backbone.",
        objective:
          "Build a make_layer helper that creates a sequence of ResidualBlocks.",
        code_snippet: {
          language: "python",
          starter_code:
            "def make_layer(in_channels, out_channels, num_blocks, stride=1):\n    # TODO: First block handles the stride/channel change\n    # TODO: Remaining blocks use stride=1 and same channels\n    pass",
          solution_code:
            "def make_layer(in_channels, out_channels, num_blocks, stride=1):\n    layers = [ResidualBlock(in_channels, out_channels, stride)]\n    for _ in range(1, num_blocks):\n        layers.append(ResidualBlock(out_channels, out_channels))\n    return nn.Sequential(*layers)",
        },
        hints: [
          "Only the first block in each layer handles the stride — subsequent blocks use stride=1",
          "After the first block, in_channels == out_channels for all remaining blocks",
          "Use nn.Sequential(*layers) to chain the blocks together",
        ],
        unit_test:
          "layer = make_layer(64, 128, num_blocks=3, stride=2)\nx = torch.rand(2, 64, 32, 32)\nassert layer(x).shape == (2, 128, 16, 16)",
      },
      {
        step_id: 3,
        title: "Full ResNet-18",
        description:
          "Assemble all layers into a complete ResNet-18 model with a classification head.",
        objective:
          "Build the full ResNet-18 architecture with 4 layer groups and a global average pooling classifier.",
        code_snippet: {
          language: "python",
          starter_code:
            "class ResNet18(nn.Module):\n    def __init__(self, num_classes=1000):\n        super().__init__()\n        # TODO: Initial 7x7 conv + maxpool\n        # TODO: 4 layer groups: [64,64], [128,128], [256,256], [512,512]\n        # TODO: Global avg pool + FC classifier\n        pass\n\n    def forward(self, x):\n        pass",
          solution_code:
            "class ResNet18(nn.Module):\n    def __init__(self, num_classes=1000):\n        super().__init__()\n        self.conv1 = nn.Conv2d(3, 64, 7, stride=2, padding=3, bias=False)\n        self.bn1 = nn.BatchNorm2d(64)\n        self.relu = nn.ReLU(inplace=True)\n        self.maxpool = nn.MaxPool2d(3, stride=2, padding=1)\n        self.layer1 = make_layer(64, 64, 2)\n        self.layer2 = make_layer(64, 128, 2, stride=2)\n        self.layer3 = make_layer(128, 256, 2, stride=2)\n        self.layer4 = make_layer(256, 512, 2, stride=2)\n        self.avgpool = nn.AdaptiveAvgPool2d((1, 1))\n        self.fc = nn.Linear(512, num_classes)\n\n    def forward(self, x):\n        x = self.maxpool(self.relu(self.bn1(self.conv1(x))))\n        x = self.layer1(x)\n        x = self.layer2(x)\n        x = self.layer3(x)\n        x = self.layer4(x)\n        x = torch.flatten(self.avgpool(x), 1)\n        return self.fc(x)",
        },
        hints: [
          "The stem is: Conv 7x7, stride 2 → BN → ReLU → MaxPool 3x3, stride 2",
          "ResNet-18 has [2, 2, 2, 2] blocks per layer group",
          "Use AdaptiveAvgPool2d((1,1)) for global average pooling — it works for any input size",
          "Flatten before the final FC layer with torch.flatten(x, 1)",
        ],
        unit_test:
          "model = ResNet18(num_classes=10)\nx = torch.rand(2, 3, 224, 224)\nassert model(x).shape == (2, 10)",
      },
    ],
  },
  {
    id: 3,
    slug: "generative-adversarial-nets",
    title: "Generative Adversarial Nets",
    authors: ["Goodfellow et al."],
    year: 2014,
    category: "Generative",
    difficulty: "intermediate",
    arxiv_url: "https://arxiv.org/abs/1406.2661",
    description:
      "Introduces GANs — two networks (Generator and Discriminator) competing in a minimax game to produce realistic data.",
    is_premium: false,
    implementation_steps: [
      {
        step_id: 1,
        title: "Generator Network",
        description:
          "Build a Generator that maps a random noise vector z to a realistic-looking image.",
        objective:
          "Implement a Generator MLP that takes a 100-dim noise vector and outputs a 784-dim (28x28) image.",
        code_snippet: {
          language: "python",
          starter_code:
            "class Generator(nn.Module):\n    def __init__(self, z_dim=100, img_dim=784):\n        super().__init__()\n        # TODO: MLP: z_dim -> 256 -> 512 -> 1024 -> img_dim\n        # TODO: Use LeakyReLU for hidden layers, Tanh at output\n        pass\n\n    def forward(self, z):\n        pass",
          solution_code:
            'class Generator(nn.Module):\n    def __init__(self, z_dim=100, img_dim=784):\n        super().__init__()\n        self.net = nn.Sequential(\n            nn.Linear(z_dim, 256), nn.LeakyReLU(0.2),\n            nn.Linear(256, 512), nn.LeakyReLU(0.2),\n            nn.Linear(512, 1024), nn.LeakyReLU(0.2),\n            nn.Linear(1024, img_dim), nn.Tanh()\n        )\n    def forward(self, z):\n        return self.net(z)',
        },
        hints: [
          "Use Tanh at the output so pixel values are in range [-1, 1] — normalize your real images to match",
          "LeakyReLU (slope ~0.2) works better than ReLU in GANs to avoid dying neurons",
          "The noise vector z is typically sampled from N(0,1) — torch.randn(batch, z_dim)",
        ],
        unit_test:
          "G = Generator()\nz = torch.randn(4, 100)\nassert G(z).shape == (4, 784)",
      },
      {
        step_id: 2,
        title: "Discriminator Network",
        description:
          "Build a Discriminator that classifies images as real or fake.",
        objective:
          "Implement a Discriminator MLP that takes a 784-dim image and outputs a single probability.",
        code_snippet: {
          language: "python",
          starter_code:
            "class Discriminator(nn.Module):\n    def __init__(self, img_dim=784):\n        super().__init__()\n        # TODO: MLP: img_dim -> 1024 -> 512 -> 256 -> 1\n        # TODO: LeakyReLU hidden, Sigmoid output\n        pass\n\n    def forward(self, x):\n        pass",
          solution_code:
            'class Discriminator(nn.Module):\n    def __init__(self, img_dim=784):\n        super().__init__()\n        self.net = nn.Sequential(\n            nn.Linear(img_dim, 1024), nn.LeakyReLU(0.2),\n            nn.Linear(1024, 512), nn.LeakyReLU(0.2),\n            nn.Linear(512, 256), nn.LeakyReLU(0.2),\n            nn.Linear(256, 1), nn.Sigmoid()\n        )\n    def forward(self, x):\n        return self.net(x)',
        },
        hints: [
          "Output is a single scalar via Sigmoid — 1 means real, 0 means fake",
          "The discriminator goes wide-to-narrow (opposite of generator)",
          "Dropout can be added for regularization but isn't in the original paper",
        ],
        unit_test:
          "D = Discriminator()\nx = torch.rand(4, 784)\nassert D(x).shape == (4, 1)",
      },
      {
        step_id: 3,
        title: "Training Loop",
        description:
          "Implement the adversarial training loop where D and G are trained alternately.",
        objective:
          "Write one training step that updates D to distinguish real/fake, then updates G to fool D.",
        code_snippet: {
          language: "python",
          starter_code:
            "def train_step(G, D, real_imgs, optimizer_G, optimizer_D, z_dim=100):\n    criterion = nn.BCELoss()\n    batch_size = real_imgs.size(0)\n    real_labels = torch.ones(batch_size, 1)\n    fake_labels = torch.zeros(batch_size, 1)\n\n    # TODO: Train Discriminator\n    # - Loss on real images (label=1)\n    # - Loss on fake images (label=0)\n\n    # TODO: Train Generator\n    # - Generate fakes and try to fool D (label=1)\n    pass",
          solution_code:
            "def train_step(G, D, real_imgs, optimizer_G, optimizer_D, z_dim=100):\n    criterion = nn.BCELoss()\n    batch_size = real_imgs.size(0)\n    real_labels = torch.ones(batch_size, 1)\n    fake_labels = torch.zeros(batch_size, 1)\n\n    # Train Discriminator\n    optimizer_D.zero_grad()\n    real_loss = criterion(D(real_imgs), real_labels)\n    z = torch.randn(batch_size, z_dim)\n    fake_imgs = G(z).detach()\n    fake_loss = criterion(D(fake_imgs), fake_labels)\n    d_loss = real_loss + fake_loss\n    d_loss.backward()\n    optimizer_D.step()\n\n    # Train Generator\n    optimizer_G.zero_grad()\n    z = torch.randn(batch_size, z_dim)\n    fake_imgs = G(z)\n    g_loss = criterion(D(fake_imgs), real_labels)\n    g_loss.backward()\n    optimizer_G.step()\n    return d_loss.item(), g_loss.item()",
        },
        hints: [
          "Use .detach() when generating fakes for the discriminator update — you don't want G gradients to flow",
          "For the generator update, label the fakes as REAL (1s) — G wants D to think they're real",
          "Always zero_grad() before each backward pass",
          "Generate a new noise batch for the generator update step",
        ],
        unit_test:
          "G, D = Generator(), Discriminator()\nopt_G = torch.optim.Adam(G.parameters(), lr=2e-4)\nopt_D = torch.optim.Adam(D.parameters(), lr=2e-4)\nreal = torch.rand(8, 784)\nd_loss, g_loss = train_step(G, D, real, opt_G, opt_D)\nassert isinstance(d_loss, float) and isinstance(g_loss, float)",
      },
    ],
  },
  {
    id: 4,
    slug: "auto-encoding-variational-bayes",
    title: "Auto-Encoding Variational Bayes (VAE)",
    authors: ["Kingma & Welling"],
    year: 2013,
    category: "Generative",
    difficulty: "intermediate",
    arxiv_url: "https://arxiv.org/abs/1312.6114",
    description:
      "Introduces the VAE — a generative model that learns a structured latent space using variational inference.",
    is_premium: false,
    implementation_steps: [
      {
        step_id: 1,
        title: "Encoder (Inference Network)",
        description:
          "Build the encoder that maps input x to parameters (mu, log_var) of the latent distribution.",
        objective:
          "Implement an Encoder that outputs mu and log_var vectors for the latent space q(z|x).",
        code_snippet: {
          language: "python",
          starter_code:
            "class Encoder(nn.Module):\n    def __init__(self, input_dim=784, hidden_dim=400, latent_dim=20):\n        super().__init__()\n        # TODO: FC layer input->hidden\n        # TODO: Two separate FC heads for mu and log_var\n        pass\n\n    def forward(self, x):\n        # TODO: Return mu and log_var\n        pass",
          solution_code:
            "class Encoder(nn.Module):\n    def __init__(self, input_dim=784, hidden_dim=400, latent_dim=20):\n        super().__init__()\n        self.fc = nn.Linear(input_dim, hidden_dim)\n        self.fc_mu = nn.Linear(hidden_dim, latent_dim)\n        self.fc_logvar = nn.Linear(hidden_dim, latent_dim)\n\n    def forward(self, x):\n        h = torch.relu(self.fc(x))\n        return self.fc_mu(h), self.fc_logvar(h)",
        },
        hints: [
          "The encoder outputs two separate vectors, not one — mu and log_var have the same shape",
          "Use two separate linear layers (fc_mu and fc_logvar) both branching from the same hidden layer",
          "We output log_var (not var) for numerical stability — it can be any real number",
        ],
        unit_test:
          "enc = Encoder()\nx = torch.rand(4, 784)\nmu, logvar = enc(x)\nassert mu.shape == (4, 20) and logvar.shape == (4, 20)",
      },
      {
        step_id: 2,
        title: "Reparameterization Trick",
        description:
          "Sample z from the latent distribution in a differentiable way using the reparameterization trick.",
        objective:
          "Implement reparameterize(mu, log_var) that returns a sample z = mu + eps * std.",
        code_snippet: {
          language: "python",
          starter_code:
            "def reparameterize(mu, log_var):\n    # TODO: Compute std from log_var\n    # TODO: Sample epsilon from N(0,1)\n    # TODO: Return z = mu + epsilon * std\n    pass",
          solution_code:
            "def reparameterize(mu, log_var):\n    std = torch.exp(0.5 * log_var)\n    eps = torch.randn_like(std)\n    return mu + eps * std",
        },
        hints: [
          "std = exp(0.5 * log_var) because log_var = log(sigma^2), so sigma = exp(log_var/2)",
          "Use torch.randn_like(std) to sample eps with the same shape and device as std",
          "This trick moves the randomness to eps (not differentiable) and keeps mu, std in the computation graph",
        ],
        unit_test:
          "mu = torch.zeros(4, 20)\nlogvar = torch.zeros(4, 20)\nz = reparameterize(mu, logvar)\nassert z.shape == (4, 20)",
      },
      {
        step_id: 3,
        title: "Decoder + ELBO Loss",
        description:
          "Build the decoder and implement the ELBO loss combining reconstruction loss and KL divergence.",
        objective:
          "Implement the Decoder and the vae_loss function = Reconstruction Loss + KL Divergence.",
        code_snippet: {
          language: "python",
          starter_code:
            "class Decoder(nn.Module):\n    def __init__(self, latent_dim=20, hidden_dim=400, output_dim=784):\n        super().__init__()\n        # TODO: FC layers latent -> hidden -> output with Sigmoid at end\n        pass\n\n    def forward(self, z):\n        pass\n\ndef vae_loss(recon_x, x, mu, log_var):\n    # TODO: BCE reconstruction loss\n    # TODO: KL divergence: -0.5 * sum(1 + log_var - mu^2 - exp(log_var))\n    pass",
          solution_code:
            "class Decoder(nn.Module):\n    def __init__(self, latent_dim=20, hidden_dim=400, output_dim=784):\n        super().__init__()\n        self.net = nn.Sequential(\n            nn.Linear(latent_dim, hidden_dim), nn.ReLU(),\n            nn.Linear(hidden_dim, output_dim), nn.Sigmoid()\n        )\n    def forward(self, z):\n        return self.net(z)\n\ndef vae_loss(recon_x, x, mu, log_var):\n    bce = nn.functional.binary_cross_entropy(recon_x, x, reduction='sum')\n    kld = -0.5 * torch.sum(1 + log_var - mu.pow(2) - log_var.exp())\n    return bce + kld",
        },
        hints: [
          "Decoder output uses Sigmoid to produce values in [0,1] matching pixel intensities",
          "Use reduction='sum' in BCE loss — the KL term also sums, so they're on the same scale",
          "KL formula: -0.5 * Σ(1 + log_var - mu² - exp(log_var)) — this is the closed form for N(mu,var) vs N(0,1)",
          "The ELBO = Reconstruction Term - KL Divergence; minimizing -ELBO = maximizing evidence",
        ],
        unit_test:
          "dec = Decoder()\nz = torch.randn(4, 20)\nassert dec(z).shape == (4, 784)\nrecon = dec(z)\nx = torch.rand(4, 784)\nmu, lv = torch.zeros(4,20), torch.zeros(4,20)\nloss = vae_loss(recon, x, mu, lv)\nassert loss.item() > 0",
      },
    ],
  },
  {
    id: 5,
    slug: "batch-normalization",
    title: "Batch Normalization: Accelerating Deep Network Training",
    authors: ["Ioffe & Szegedy"],
    year: 2015,
    category: "Basics",
    difficulty: "beginner",
    arxiv_url: "https://arxiv.org/abs/1502.03167",
    description:
      "Normalizes layer inputs across the batch to reduce internal covariate shift and speed up training.",
    is_premium: false,
    implementation_steps: [
      {
        step_id: 1,
        title: "Batch Norm Forward Pass",
        description:
          "Implement batch normalization from scratch for the training phase.",
        objective:
          "Normalize inputs across the batch, then scale and shift with learnable parameters gamma and beta.",
        code_snippet: {
          language: "python",
          starter_code:
            "class BatchNorm1d(nn.Module):\n    def __init__(self, num_features, eps=1e-5, momentum=0.1):\n        super().__init__()\n        self.gamma = nn.Parameter(torch.ones(num_features))\n        self.beta = nn.Parameter(torch.zeros(num_features))\n        self.register_buffer('running_mean', torch.zeros(num_features))\n        self.register_buffer('running_var', torch.ones(num_features))\n        self.eps = eps\n        self.momentum = momentum\n\n    def forward(self, x):\n        if self.training:\n            # TODO: Compute batch mean and variance\n            # TODO: Normalize x\n            # TODO: Update running stats\n            pass\n        else:\n            # TODO: Use running mean/var for inference\n            pass\n        # TODO: Scale and shift\n        pass",
          solution_code:
            "class BatchNorm1d(nn.Module):\n    def __init__(self, num_features, eps=1e-5, momentum=0.1):\n        super().__init__()\n        self.gamma = nn.Parameter(torch.ones(num_features))\n        self.beta = nn.Parameter(torch.zeros(num_features))\n        self.register_buffer('running_mean', torch.zeros(num_features))\n        self.register_buffer('running_var', torch.ones(num_features))\n        self.eps = eps\n        self.momentum = momentum\n\n    def forward(self, x):\n        if self.training:\n            mean = x.mean(dim=0)\n            var = x.var(dim=0, unbiased=False)\n            self.running_mean = (1 - self.momentum) * self.running_mean + self.momentum * mean\n            self.running_var = (1 - self.momentum) * self.running_var + self.momentum * var\n        else:\n            mean = self.running_mean\n            var = self.running_var\n        x_norm = (x - mean) / torch.sqrt(var + self.eps)\n        return self.gamma * x_norm + self.beta",
        },
        hints: [
          "Training: compute mean/var over the batch dimension (dim=0). Inference: use running stats",
          "running_mean update: (1 - momentum) * running_mean + momentum * batch_mean",
          "eps is added inside sqrt to prevent division by zero",
          "gamma and beta are learnable (nn.Parameter), running stats are buffers (not learned)",
        ],
        unit_test:
          "bn = BatchNorm1d(16)\nx = torch.rand(32, 16)\nout = bn(x)\nassert out.shape == (32, 16)\nassert abs(out.mean().item()) < 0.1",
      },
    ],
  },
  {
    id: 6,
    slug: "dropout",
    title: "Dropout: A Simple Way to Prevent Neural Networks from Overfitting",
    authors: ["Srivastava et al."],
    year: 2014,
    category: "Basics",
    difficulty: "beginner",
    arxiv_url: "https://jmlr.org/papers/v15/srivastava14a.html",
    description:
      "Randomly drops neurons during training as a regularization technique to prevent overfitting.",
    is_premium: false,
    implementation_steps: [
      {
        step_id: 1,
        title: "Inverted Dropout",
        description:
          "Implement dropout from scratch using the inverted dropout technique used in practice.",
        objective:
          "During training, randomly zero out neurons with probability p and scale up survivors by 1/(1-p).",
        code_snippet: {
          language: "python",
          starter_code:
            'class Dropout(nn.Module):\n    def __init__(self, p=0.5):\n        super().__init__()\n        self.p = p\n\n    def forward(self, x):\n        if not self.training:\n            return x\n        # TODO: Create a binary mask from Bernoulli(1-p)\n        # TODO: Apply mask and scale by 1/(1-p)\n        pass',
          solution_code:
            "class Dropout(nn.Module):\n    def __init__(self, p=0.5):\n        super().__init__()\n        self.p = p\n\n    def forward(self, x):\n        if not self.training:\n            return x\n        mask = (torch.rand_like(x) > self.p).float()\n        return x * mask / (1 - self.p)",
        },
        hints: [
          "At inference, return x unchanged — dropout is training-only",
          "Use torch.rand_like(x) > p to get a mask where each element is kept with probability (1-p)",
          "Inverted dropout: scale surviving activations by 1/(1-p) so expected values match at inference time",
          "The mask should be float so multiplication works correctly",
        ],
        unit_test:
          "drop = Dropout(p=0.5)\ndrop.train()\nx = torch.ones(1000, 100)\nout = drop(x)\nfrac_zero = (out == 0).float().mean().item()\nassert 0.4 < frac_zero < 0.6, 'Expected ~50% zeros'",
      },
    ],
  },
  {
    id: 7,
    slug: "lstm",
    title: "Long Short-Term Memory",
    authors: ["Hochreiter & Schmidhuber"],
    year: 1997,
    category: "Sequence",
    difficulty: "intermediate",
    arxiv_url: "https://www.bioinf.jku.at/publications/older/2604.pdf",
    description:
      "Introduces gated memory cells to solve the vanishing gradient problem in recurrent networks.",
    is_premium: false,
    implementation_steps: [
      {
        step_id: 1,
        title: "LSTM Cell",
        description:
          "Implement a single LSTM cell computing all 4 gates and updating the cell/hidden state.",
        objective:
          "Given input x_t, h_{t-1}, c_{t-1}, compute the new h_t and c_t using forget, input, gate, and output gates.",
        code_snippet: {
          language: "python",
          starter_code:
            "class LSTMCell(nn.Module):\n    def __init__(self, input_size, hidden_size):\n        super().__init__()\n        # TODO: Single combined linear layer for all 4 gates (4 * hidden_size)\n        pass\n\n    def forward(self, x, h_prev, c_prev):\n        # TODO: Compute gates: forget, input, gate (cell), output\n        # TODO: Update cell state: c = f*c_prev + i*g\n        # TODO: Update hidden state: h = o * tanh(c)\n        pass",
          solution_code:
            "class LSTMCell(nn.Module):\n    def __init__(self, input_size, hidden_size):\n        super().__init__()\n        self.hidden_size = hidden_size\n        self.linear = nn.Linear(input_size + hidden_size, 4 * hidden_size)\n\n    def forward(self, x, h_prev, c_prev):\n        combined = torch.cat([x, h_prev], dim=1)\n        gates = self.linear(combined)\n        f, i, g, o = gates.chunk(4, dim=1)\n        f = torch.sigmoid(f)\n        i = torch.sigmoid(i)\n        g = torch.tanh(g)\n        o = torch.sigmoid(o)\n        c = f * c_prev + i * g\n        h = o * torch.tanh(c)\n        return h, c",
        },
        hints: [
          "Concatenate x and h_prev along dim=1, then pass through a single linear layer of size 4*hidden",
          "Use .chunk(4, dim=1) to split the output into 4 equal gate tensors",
          "Forget (f), input (i), output (o) gates use Sigmoid. The cell gate (g) uses Tanh",
          "Cell state: c_t = f ⊙ c_{t-1} + i ⊙ g. Hidden: h_t = o ⊙ tanh(c_t)",
        ],
        unit_test:
          "cell = LSTMCell(10, 20)\nx = torch.rand(4, 10)\nh = torch.zeros(4, 20)\nc = torch.zeros(4, 20)\nh_new, c_new = cell(x, h, c)\nassert h_new.shape == (4, 20) and c_new.shape == (4, 20)",
      },
    ],
  },
  {
    id: 8,
    slug: "alexnet",
    title: "ImageNet Classification with Deep CNNs (AlexNet)",
    authors: ["Krizhevsky, Sutskever & Hinton"],
    year: 2012,
    category: "Vision",
    difficulty: "beginner",
    arxiv_url:
      "https://papers.nips.cc/paper/2012/hash/c399862d3b9d6b76c8436e924a68c45b-Abstract.html",
    description:
      "The landmark deep CNN that won ImageNet 2012, bringing deep learning into mainstream research.",
    is_premium: false,
    implementation_steps: [
      {
        step_id: 1,
        title: "Feature Extractor (Conv Layers)",
        description:
          "Build the 5 convolutional layers of AlexNet with ReLU and MaxPooling.",
        objective:
          "Implement the AlexNet feature extractor: 5 conv layers, with pooling at layers 1, 2, and 5.",
        code_snippet: {
          language: "python",
          starter_code:
            "class AlexNetFeatures(nn.Module):\n    def __init__(self):\n        super().__init__()\n        # TODO: Conv1: 3->96, 11x11, stride 4 -> ReLU -> MaxPool 3x3 stride 2\n        # TODO: Conv2: 96->256, 5x5, pad 2 -> ReLU -> MaxPool 3x3 stride 2\n        # TODO: Conv3: 256->384, 3x3, pad 1 -> ReLU\n        # TODO: Conv4: 384->384, 3x3, pad 1 -> ReLU\n        # TODO: Conv5: 384->256, 3x3, pad 1 -> ReLU -> MaxPool 3x3 stride 2\n        pass",
          solution_code:
            "class AlexNetFeatures(nn.Module):\n    def __init__(self):\n        super().__init__()\n        self.features = nn.Sequential(\n            nn.Conv2d(3, 96, 11, stride=4), nn.ReLU(inplace=True), nn.MaxPool2d(3, stride=2),\n            nn.Conv2d(96, 256, 5, padding=2), nn.ReLU(inplace=True), nn.MaxPool2d(3, stride=2),\n            nn.Conv2d(256, 384, 3, padding=1), nn.ReLU(inplace=True),\n            nn.Conv2d(384, 384, 3, padding=1), nn.ReLU(inplace=True),\n            nn.Conv2d(384, 256, 3, padding=1), nn.ReLU(inplace=True), nn.MaxPool2d(3, stride=2),\n        )\n    def forward(self, x):\n        return self.features(x)",
        },
        hints: [
          "Only 3 of the 5 conv layers are followed by MaxPool",
          "Conv1 uses stride=4 with no padding — this is what aggressively reduces spatial resolution",
          "Layers 3, 4, 5 all use 3x3 kernels with padding=1 to preserve spatial dims",
        ],
        unit_test:
          "feat = AlexNetFeatures()\nx = torch.rand(2, 3, 227, 227)\nassert feat(x).shape == (2, 256, 6, 6)",
      },
      {
        step_id: 2,
        title: "Classifier (FC Layers)",
        description:
          "Add the 3-layer fully connected classifier with dropout.",
        objective:
          "Build the AlexNet classifier: Dropout → FC4096 → ReLU → Dropout → FC4096 → ReLU → FC1000.",
        code_snippet: {
          language: "python",
          starter_code:
            "class AlexNet(nn.Module):\n    def __init__(self, num_classes=1000):\n        super().__init__()\n        self.features = AlexNetFeatures()\n        self.avgpool = nn.AdaptiveAvgPool2d((6, 6))\n        # TODO: Build the classifier sequential block\n        pass\n\n    def forward(self, x):\n        pass",
          solution_code:
            "class AlexNet(nn.Module):\n    def __init__(self, num_classes=1000):\n        super().__init__()\n        self.features = AlexNetFeatures()\n        self.avgpool = nn.AdaptiveAvgPool2d((6, 6))\n        self.classifier = nn.Sequential(\n            nn.Dropout(0.5), nn.Linear(256*6*6, 4096), nn.ReLU(inplace=True),\n            nn.Dropout(0.5), nn.Linear(4096, 4096), nn.ReLU(inplace=True),\n            nn.Linear(4096, num_classes)\n        )\n    def forward(self, x):\n        x = self.avgpool(self.features(x))\n        x = torch.flatten(x, 1)\n        return self.classifier(x)",
        },
        hints: [
          "The AdaptiveAvgPool ensures the feature map is always 6x6 regardless of input size",
          "Flatten before the FC layers: 256 * 6 * 6 = 9216",
          "Dropout (p=0.5) is applied before the first two FC layers — this was a key contribution",
        ],
        unit_test:
          "model = AlexNet(num_classes=1000)\nx = torch.rand(2, 3, 227, 227)\nassert model(x).shape == (2, 1000)",
      },
    ],
  },
  {
    id: 9,
    slug: "word2vec",
    title:
      "Efficient Estimation of Word Representations in Vector Space (Word2Vec)",
    authors: ["Mikolov et al."],
    year: 2013,
    category: "NLP",
    difficulty: "beginner",
    arxiv_url: "https://arxiv.org/abs/1301.3781",
    description:
      "Learns dense word embeddings using shallow neural networks with Skip-Gram or CBOW objectives.",
    is_premium: false,
    implementation_steps: [
      {
        step_id: 1,
        title: "Skip-Gram Model",
        description:
          "Build the Skip-Gram model that predicts surrounding context words from a center word.",
        objective:
          "Implement a Skip-Gram model with an embedding layer and output projection.",
        code_snippet: {
          language: "python",
          starter_code:
            "class SkipGram(nn.Module):\n    def __init__(self, vocab_size, embed_dim=100):\n        super().__init__()\n        # TODO: Embedding layer for center words\n        # TODO: Linear output layer to predict context words\n        pass\n\n    def forward(self, center_word):\n        # TODO: Lookup embedding, project to vocab logits\n        pass",
          solution_code:
            "class SkipGram(nn.Module):\n    def __init__(self, vocab_size, embed_dim=100):\n        super().__init__()\n        self.embeddings = nn.Embedding(vocab_size, embed_dim)\n        self.out = nn.Linear(embed_dim, vocab_size)\n\n    def forward(self, center_word):\n        embed = self.embeddings(center_word)\n        return self.out(embed)",
        },
        hints: [
          "nn.Embedding maps integer word indices to dense vectors of size embed_dim",
          "The output layer projects from embed_dim to vocab_size — use CrossEntropyLoss during training",
          "After training, self.embeddings.weight IS your word vector matrix",
        ],
        unit_test:
          "model = SkipGram(vocab_size=1000, embed_dim=100)\ncenter = torch.randint(0, 1000, (4,))\nassert model(center).shape == (4, 1000)",
      },
    ],
  },
  {
    id: 10,
    slug: "denoising-diffusion-probabilistic-models",
    title: "Denoising Diffusion Probabilistic Models (DDPM)",
    authors: ["Ho, Jain & Abbeel"],
    year: 2020,
    category: "Generative",
    difficulty: "advanced",
    arxiv_url: "https://arxiv.org/abs/2006.11239",
    description:
      "A diffusion-based generative model that produces high-quality images via iterative denoising.",
    is_premium: true,
    implementation_steps: [
      {
        step_id: 1,
        title: "Noise Schedule",
        description:
          "Define the linear beta schedule that controls how much noise is added at each diffusion timestep.",
        objective:
          "Precompute beta, alpha, and alpha_bar for T timesteps needed for the forward and reverse process.",
        code_snippet: {
          language: "python",
          starter_code:
            "def get_noise_schedule(T=1000, beta_start=1e-4, beta_end=0.02):\n    # TODO: Linear schedule for beta from beta_start to beta_end\n    # TODO: Compute alpha = 1 - beta\n    # TODO: Compute alpha_bar = cumulative product of alpha\n    pass",
          solution_code:
            "def get_noise_schedule(T=1000, beta_start=1e-4, beta_end=0.02):\n    betas = torch.linspace(beta_start, beta_end, T)\n    alphas = 1.0 - betas\n    alpha_bars = torch.cumprod(alphas, dim=0)\n    return betas, alphas, alpha_bars",
        },
        hints: [
          "torch.linspace(start, end, steps) creates the linear schedule",
          "alpha_t = 1 - beta_t for each timestep",
          "alpha_bar_t = product of all alphas from step 1 to t — use torch.cumprod",
          "alpha_bar is the key quantity: x_t = sqrt(alpha_bar_t)*x_0 + sqrt(1-alpha_bar_t)*noise",
        ],
        unit_test:
          "betas, alphas, alpha_bars = get_noise_schedule()\nassert betas.shape == (1000,)\nassert abs(betas[0].item() - 1e-4) < 1e-6\nassert abs(betas[-1].item() - 0.02) < 1e-6\nassert alpha_bars[-1].item() < 0.01",
      },
      {
        step_id: 2,
        title: "Forward Diffusion Process",
        description:
          "Implement q(x_t | x_0) — sample a noisy version of x_0 at any arbitrary timestep t in one shot.",
        objective:
          "Use the closed-form formula to add exactly the right amount of noise for timestep t.",
        code_snippet: {
          language: "python",
          starter_code:
            "def q_sample(x0, t, alpha_bars, noise=None):\n    # TODO: If noise is None, sample from N(0, I)\n    # TODO: Use closed form: x_t = sqrt(alpha_bar_t)*x0 + sqrt(1-alpha_bar_t)*noise\n    pass",
          solution_code:
            "def q_sample(x0, t, alpha_bars, noise=None):\n    if noise is None:\n        noise = torch.randn_like(x0)\n    sqrt_alpha_bar = alpha_bars[t].sqrt().view(-1, 1, 1, 1)\n    sqrt_one_minus = (1 - alpha_bars[t]).sqrt().view(-1, 1, 1, 1)\n    return sqrt_alpha_bar * x0 + sqrt_one_minus * noise, noise",
        },
        hints: [
          "The closed form means you don't have to apply noise T times — one formula jumps directly to step t",
          "Reshape alpha_bar[t] to (batch, 1, 1, 1) so it broadcasts over image dims",
          "Return both the noisy image AND the noise — you'll need the noise as the training target",
        ],
        unit_test:
          "_, _, alpha_bars = get_noise_schedule()\nx0 = torch.rand(4, 3, 32, 32)\nt = torch.randint(0, 1000, (4,))\nxt, noise = q_sample(x0, t, alpha_bars)\nassert xt.shape == (4, 3, 32, 32)",
      },
    ],
  },
];

export default papers;
