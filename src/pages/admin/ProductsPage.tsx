import { useState } from 'react';
import { Plus, Search, Edit2, Trash2, Package, X, Upload, AlertTriangle, Bot, Loader2, Link } from 'lucide-react';
import { useProductStore } from '../../store/productStore';
import { useNotificationStore } from '../../store/notificationStore';
import { useSettingsStore } from '../../store/settingsStore';
import { importFromAliExpress } from '../../utils/aliexpressImporter';
import Modal from '../../components/common/Modal';
import type { Product, ProductImage } from '../../types';

const defaultImages = [
  'https://images.pexels.com/photos/37420781/pexels-photo-37420781.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940',
  'https://images.pexels.com/photos/12564670/pexels-photo-12564670.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940',
  'https://images.pexels.com/photos/6167446/pexels-photo-6167446.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',
];

export default function ProductsPage() {
  const { products, categories, addProduct, updateProduct, deleteProduct } = useProductStore();
  const addNotification = useNotificationStore((state) => state.addNotification);
  const { apiKeys } = useSettingsStore();

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const [showAliModal, setShowAliModal] = useState(false);
  const [aliUrl, setAliUrl] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [aliError, setAliError] = useState('');

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    price: '',
    originalPrice: '',
    category: '',
    stock: '',
    sku: '',
    isActive: true,
    images: [] as ProductImage[],
  });

  const filteredProducts = products.filter((p) => {
    const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = categoryFilter === 'All' || p.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const handleOpenModal = (product?: Product) => {
    if (product) {
      setEditingProduct(product);
      setFormData({
        name: product.name,
        description: product.description,
        price: product.price.toString(),
        originalPrice: product.originalPrice.toString(),
        category: product.category,
        stock: product.stock.toString(),
        sku: product.sku,
        isActive: product.isActive,
        images: product.images,
      });
    } else {
      setEditingProduct(null);
      setFormData({
        name: '',
        description: '',
        price: '',
        originalPrice: '',
        category: categories[0]?.name || '',
        stock: '',
        sku: `LE-${Date.now().toString().slice(-6)}`,
        isActive: true,
        images: [],
      });
    }
    setShowModal(true);
  };

  const handleAliImport = async () => {
    if (!aliUrl.trim()) return;
    setIsImporting(true);
    setAliError('');
    try {
      const data = await importFromAliExpress(
        aliUrl.trim(),
        apiKeys.scrapedoKey || undefined,
        apiKeys.scraperApiKey || undefined
      );
      const importedImages: ProductImage[] = data.images.map((url, i) => ({
        id: `img-${Date.now()}-${i}`,
        url,
        isPrimary: i === 0,
      }));
      setShowAliModal(false);
      setAliUrl('');
      setEditingProduct(null);
      setFormData({
        name: data.title,
        description: data.description,
        price: data.price.toFixed(2),
        originalPrice: data.originalPrice.toFixed(2),
        category: data.category || categories[0]?.name || '',
        stock: '100',
        sku: data.sku,
        isActive: false,
        images: importedImages,
      });
      setShowModal(true);
      addNotification({ type: 'success', message: 'Product imported! Review and publish.' });
    } catch (err) {
      setAliError(err instanceof Error ? err.message : 'Import failed. Please try again.');
    } finally {
      setIsImporting(false);
    }
  };

  const handleAddImage = () => {
    if (formData.images.length >= 10) {
      addNotification({ type: 'warning', message: 'Maximum 10 images allowed' });
      return;
    }
    const newImage: ProductImage = {
      id: `img-${Date.now()}`,
      url: defaultImages[formData.images.length % defaultImages.length],
      isPrimary: formData.images.length === 0,
    };
    setFormData({ ...formData, images: [...formData.images, newImage] });
  };

  const handleAddImageUrl = (url: string) => {
    if (!url.trim() || formData.images.length >= 10) return;
    const newImage: ProductImage = {
      id: `img-${Date.now()}`,
      url: url.trim(),
      isPrimary: formData.images.length === 0,
    };
    setFormData({ ...formData, images: [...formData.images, newImage] });
  };

  const handleRemoveImage = (imageId: string) => {
    const newImages = formData.images.filter((img) => img.id !== imageId);
    if (newImages.length > 0 && !newImages.some((img) => img.isPrimary)) newImages[0].isPrimary = true;
    setFormData({ ...formData, images: newImages });
  };

  const handleSetPrimary = (imageId: string) => {
    setFormData({ ...formData, images: formData.images.map((img) => ({ ...img, isPrimary: img.id === imageId })) });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const productData = {
      name: formData.name,
      description: formData.description,
      price: parseFloat(formData.price),
      originalPrice: parseFloat(formData.originalPrice),
      category: formData.category,
      stock: parseInt(formData.stock),
      sku: formData.sku,
      isActive: formData.isActive,
      images: formData.images.length > 0 ? formData.images : [{ id: 'img-default', url: defaultImages[0], isPrimary: true }],
    };
    if (editingProduct) {
      updateProduct(editingProduct.id, productData);
      addNotification({ type: 'success', message: 'Product updated!' });
    } else {
      addProduct(productData);
      addNotification({ type: 'success', message: 'Product added!' });
    }
    setShowModal(false);
  };

  const handleDelete = (id: string) => {
    deleteProduct(id);
    addNotification({ type: 'success', message: 'Product deleted!' });
    setDeleteConfirm(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Products</h1>
          <p className="text-gray-500 text-sm">Manage your product inventory</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setShowAliModal(true); setAliError(''); setAliUrl(''); }}
            className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white font-medium rounded-lg transition-colors"
          >
            <Bot size={18} />
            Import from AliExpress
          </button>
          <button
            onClick={() => handleOpenModal()}
            className="flex items-center gap-2 px-4 py-2 bg-admin-primary hover:bg-admin-primary-dark text-white font-medium rounded-lg transition-colors"
          >
            <Plus size={18} />
            Add Product
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 relative">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Search products..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-11 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-admin-primary" />
          </div>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-admin-primary">
            <option value="All">All Categories</option>
            {categories.map((cat) => <option key={cat.id} value={cat.name}>{cat.name}</option>)}
          </select>
        </div>
      </div>

      {/* Products Table */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-6 py-4 text-xs font-semibold text-gray-500 uppercase">Product</th>
                <th className="text-left px-6 py-4 text-xs font-semibold text-gray-500 uppercase">Category</th>
                <th className="text-left px-6 py-4 text-xs font-semibold text-gray-500 uppercase">Price</th>
                <th className="text-left px-6 py-4 text-xs font-semibold text-gray-500 uppercase">Stock</th>
                <th className="text-left px-6 py-4 text-xs font-semibold text-gray-500 uppercase">Status</th>
                <th className="text-right px-6 py-4 text-xs font-semibold text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredProducts.map((product) => (
                <tr key={product.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <img src={product.images[0]?.url} alt={product.name} className="w-12 h-12 object-cover rounded-lg" />
                      <div>
                        <p className="font-medium text-gray-900 text-sm">{product.name}</p>
                        <p className="text-xs text-gray-500">SKU: {product.sku}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">{product.category}</td>
                  <td className="px-6 py-4">
                    <p className="text-sm font-medium text-gray-900">${product.price.toFixed(2)}</p>
                    <p className="text-xs text-gray-400 line-through">${product.originalPrice.toFixed(2)}</p>
                  </td>
                  <td className="px-6 py-4">
                    {product.stock <= 10 ? (
                      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full ${ product.stock === 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700' }`}>
                        <AlertTriangle size={12} />
                        {product.stock === 0 ? 'Out of stock' : `${product.stock} left`}
                      </span>
                    ) : (
                      <span className="text-sm text-gray-600">{product.stock}</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${ product.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600' }`}>
                      {product.isActive ? 'Active' : 'Draft'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => handleOpenModal(product)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors"><Edit2 size={16} className="text-gray-500" /></button>
                      <button onClick={() => setDeleteConfirm(product.id)} className="p-2 hover:bg-red-50 rounded-lg transition-colors"><Trash2 size={16} className="text-red-500" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filteredProducts.length === 0 && (
          <div className="text-center py-12">
            <Package size={48} className="mx-auto text-gray-200 mb-4" />
            <p className="text-gray-500">No products found</p>
          </div>
        )}
      </div>

      {/* AliExpress Import Modal */}
      <Modal isOpen={showAliModal} onClose={() => setShowAliModal(false)} title="Import from AliExpress" size="md">
        <div className="p-6 space-y-4">
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Bot size={16} className="text-orange-600" />
              <p className="text-sm font-semibold text-orange-900">AI Product Import Agent</p>
            </div>
            <p className="text-xs text-orange-700 leading-relaxed">
              Paste any AliExpress product URL. The agent will auto-extract title, price, images and description.
            </p>
            {apiKeys.scrapedoKey ? (
              <p className="text-xs text-green-700 mt-2 font-medium">✓ scrape.do active — high reliability mode</p>
            ) : (
              <p className="text-xs text-orange-600 mt-2">
                For reliable imports: Settings → API Keys → add free scrape.do key (1000/month free).
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">AliExpress Product URL</label>
            <div className="relative">
              <Link size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="url"
                placeholder="https://www.aliexpress.com/item/..."
                value={aliUrl}
                onChange={(e) => { setAliUrl(e.target.value); setAliError(''); }}
                onKeyDown={(e) => e.key === 'Enter' && handleAliImport()}
                className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-orange-400"
              />
            </div>
          </div>

          {aliError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-xs text-red-700 leading-relaxed">{aliError}</p>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={handleAliImport}
              disabled={isImporting || !aliUrl.trim()}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-orange-500 hover:bg-orange-600 text-white font-medium rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isImporting ? <><Loader2 size={16} className="animate-spin" /> Importing...</> : <><Bot size={16} /> Import Product</>}
            </button>
            <button onClick={() => setShowAliModal(false)} className="px-6 py-2.5 border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </div>
      </Modal>

      {/* Add / Edit Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editingProduct ? 'Edit Product' : 'Add New Product'} size="lg">
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">Product Name</label>
              <input type="text" required value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-admin-primary" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">Description</label>
              <textarea required rows={4} value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-admin-primary resize-none" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">Price ($)</label>
              <input type="number" step="0.01" required value={formData.price} onChange={(e) => setFormData({ ...formData, price: e.target.value })} className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-admin-primary" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">Compare Price ($)</label>
              <input type="number" step="0.01" required value={formData.originalPrice} onChange={(e) => setFormData({ ...formData, originalPrice: e.target.value })} className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-admin-primary" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">Category</label>
              <select required value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })} className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-admin-primary">
                {categories.map((cat) => <option key={cat.id} value={cat.name}>{cat.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">Stock</label>
              <input type="number" required value={formData.stock} onChange={(e) => setFormData({ ...formData, stock: e.target.value })} className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-admin-primary" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">SKU</label>
              <input type="text" required value={formData.sku} onChange={(e) => setFormData({ ...formData, sku: e.target.value })} className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-admin-primary" />
            </div>
            <div className="flex items-center gap-3">
              <input type="checkbox" id="isActive" checked={formData.isActive} onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })} className="w-4 h-4 rounded text-admin-primary" />
              <label htmlFor="isActive" className="text-sm text-gray-700">Active (visible in store)</label>
            </div>
          </div>

          {/* Images */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">Product Images ({formData.images.length}/10)</label>
            <div className="flex flex-wrap gap-3 mb-3">
              {formData.images.map((img) => (
                <div key={img.id} className="relative group">
                  <img src={img.url} alt="" className={`w-20 h-20 object-cover rounded-lg border-2 cursor-pointer ${ img.isPrimary ? 'border-orange-400' : 'border-gray-200' }`} onClick={() => handleSetPrimary(img.id)} />
                  <button type="button" onClick={() => handleRemoveImage(img.id)} className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><X size={12} /></button>
                  {img.isPrimary && <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[8px] bg-orange-400 text-white px-1 rounded">Main</span>}
                </div>
              ))}
              {formData.images.length < 10 && (
                <button type="button" onClick={handleAddImage} className="w-20 h-20 border-2 border-dashed border-gray-200 rounded-lg flex flex-col items-center justify-center text-gray-400 hover:border-admin-primary hover:text-admin-primary transition-colors">
                  <Upload size={16} /><span className="text-[10px] mt-1">Sample</span>
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <input type="url" id="imageUrlInput" placeholder="Paste image URL and press Add..." className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-admin-primary"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const input = e.currentTarget; handleAddImageUrl(input.value); input.value = ''; } }}
              />
              <button type="button" onClick={() => { const input = document.getElementById('imageUrlInput') as HTMLInputElement; if (input) { handleAddImageUrl(input.value); input.value = ''; } }} className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs rounded-lg">Add URL</button>
            </div>
            <p className="text-xs text-gray-400 mt-1">Click image to set as main. Paste URL or use Sample button.</p>
          </div>

          <div className="flex gap-3 pt-4 border-t border-gray-100">
            <button type="submit" className="flex-1 py-2.5 bg-admin-primary hover:bg-admin-primary-dark text-white font-medium rounded-lg transition-colors">
              {editingProduct ? 'Save Changes' : 'Add Product'}
            </button>
            <button type="button" onClick={() => setShowModal(false)} className="px-6 py-2.5 border border-gray-200 text-gray-600 font-medium rounded-lg hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirm */}
      <Modal isOpen={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} title="Delete Product" size="sm">
        <div className="p-6">
          <p className="text-gray-600 mb-6">Are you sure? This cannot be undone.</p>
          <div className="flex gap-3">
            <button onClick={() => handleDelete(deleteConfirm!)} className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 text-white font-medium rounded-lg">Delete</button>
            <button onClick={() => setDeleteConfirm(null)} className="flex-1 py-2.5 border border-gray-200 text-gray-600 font-medium rounded-lg hover:bg-gray-50">Cancel</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
