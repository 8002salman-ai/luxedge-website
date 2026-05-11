import { useState } from 'react';
import {
  Plus,
  Edit2,
  Trash2,
  FolderTree,
  ChevronRight,
  ChevronDown,
  ToggleLeft,
  ToggleRight,
  Folder,
  FolderOpen,
} from 'lucide-react';
import { useCategoryStore, Category } from '../../store/categoryStore';
import { useNotificationStore } from '../../store/notificationStore';
import Modal from '../../components/common/Modal';

export default function CategoriesPage() {
  const {
    categories,
    addCategory,
    updateCategory,
    deleteCategory,
    toggleCategoryStatus,
    getMainCategories,
    getSubCategories,
  } = useCategoryStore();
  const addNotification = useNotificationStore((state) => state.addNotification);

  const [showModal, setShowModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    parentId: '' as string | null,
    isActive: true,
    sortOrder: 1,
  });

  const mainCategories = getMainCategories();

  const toggleExpand = (categoryId: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(categoryId)) {
      newExpanded.delete(categoryId);
    } else {
      newExpanded.add(categoryId);
    }
    setExpandedCategories(newExpanded);
  };

  const handleOpenModal = (category?: Category, parentId?: string) => {
    if (category) {
      setEditingCategory(category);
      setFormData({
        name: category.name,
        description: category.description || '',
        parentId: category.parentId,
        isActive: category.isActive,
        sortOrder: category.sortOrder,
      });
    } else {
      setEditingCategory(null);
      setFormData({
        name: '',
        description: '',
        parentId: parentId || null,
        isActive: true,
        sortOrder: categories.length + 1,
      });
    }
    setShowModal(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (editingCategory) {
      updateCategory(editingCategory.id, {
        name: formData.name,
        description: formData.description,
        parentId: formData.parentId || null,
        isActive: formData.isActive,
        sortOrder: formData.sortOrder,
      });
      addNotification({ type: 'success', message: 'Category updated successfully!' });
    } else {
      addCategory({
        name: formData.name,
        description: formData.description,
        parentId: formData.parentId || null,
        isActive: formData.isActive,
        sortOrder: formData.sortOrder,
      });
      addNotification({ type: 'success', message: 'Category added successfully!' });
    }

    setShowModal(false);
  };

  const handleDelete = (id: string) => {
    const subCategories = getSubCategories(id);
    deleteCategory(id);
    addNotification({
      type: 'success',
      message: `Category deleted${subCategories.length > 0 ? ' along with its subcategories' : ''}!`,
    });
    setDeleteConfirm(null);
  };

  const handleToggleStatus = (id: string) => {
    toggleCategoryStatus(id);
    addNotification({ type: 'success', message: 'Category status updated!' });
  };

  const renderCategory = (category: Category, level: number = 0) => {
    const subCategories = getSubCategories(category.id);
    const hasSubCategories = subCategories.length > 0;
    const isExpanded = expandedCategories.has(category.id);

    return (
      <div key={category.id}>
        <div
          className={`flex items-center gap-3 p-4 border-b border-gray-50 hover:bg-gray-50 transition-colors ${
            level > 0 ? 'bg-gray-50/50' : ''
          }`}
          style={{ paddingLeft: `${1.5 + level * 1.5}rem` }}
        >
          {/* Expand/Collapse */}
          <button
            onClick={() => hasSubCategories && toggleExpand(category.id)}
            className={`p-1 rounded ${hasSubCategories ? 'hover:bg-gray-200' : 'opacity-0'}`}
            disabled={!hasSubCategories}
          >
            {hasSubCategories ? (
              isExpanded ? (
                <ChevronDown size={16} className="text-gray-500" />
              ) : (
                <ChevronRight size={16} className="text-gray-500" />
              )
            ) : (
              <span className="w-4" />
            )}
          </button>

          {/* Icon */}
          <div
            className={`p-2 rounded-lg ${
              category.isActive ? 'bg-admin-primary/10' : 'bg-gray-100'
            }`}
          >
            {hasSubCategories && isExpanded ? (
              <FolderOpen
                size={18}
                className={category.isActive ? 'text-admin-primary' : 'text-gray-400'}
              />
            ) : (
              <Folder
                size={18}
                className={category.isActive ? 'text-admin-primary' : 'text-gray-400'}
              />
            )}
          </div>

          {/* Category Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className={`font-medium ${category.isActive ? 'text-gray-900' : 'text-gray-400'}`}>
                {category.name}
              </p>
              {level === 0 && hasSubCategories && (
                <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                  {subCategories.length} sub
                </span>
              )}
            </div>
            {category.description && (
              <p className="text-xs text-gray-500 truncate">{category.description}</p>
            )}
          </div>

          {/* Status Badge */}
          <span
            className={`text-xs font-medium px-2 py-1 rounded-full ${
              category.isActive
                ? 'bg-green-100 text-green-700'
                : 'bg-gray-100 text-gray-500'
            }`}
          >
            {category.isActive ? 'Active' : 'Inactive'}
          </span>

          {/* Actions */}
          <div className="flex items-center gap-1">
            {/* Add Subcategory (only for main categories) */}
            {level === 0 && (
              <button
                onClick={() => handleOpenModal(undefined, category.id)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                title="Add Subcategory"
              >
                <Plus size={16} className="text-gray-500" />
              </button>
            )}

            {/* Toggle Status */}
            <button
              onClick={() => handleToggleStatus(category.id)}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title={category.isActive ? 'Disable' : 'Enable'}
            >
              {category.isActive ? (
                <ToggleRight size={18} className="text-green-500" />
              ) : (
                <ToggleLeft size={18} className="text-gray-400" />
              )}
            </button>

            {/* Edit */}
            <button
              onClick={() => handleOpenModal(category)}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title="Edit"
            >
              <Edit2 size={16} className="text-gray-500" />
            </button>

            {/* Delete */}
            <button
              onClick={() => setDeleteConfirm(category.id)}
              className="p-2 hover:bg-red-50 rounded-lg transition-colors"
              title="Delete"
            >
              <Trash2 size={16} className="text-red-500" />
            </button>
          </div>
        </div>

        {/* Subcategories */}
        {hasSubCategories && isExpanded && (
          <div className="border-l-2 border-gray-100 ml-6">
            {subCategories.map((subCat) => renderCategory(subCat, level + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Categories</h1>
          <p className="text-gray-500 text-sm">
            Manage product categories and subcategories
          </p>
        </div>
        <button
          onClick={() => handleOpenModal()}
          className="flex items-center gap-2 px-4 py-2 bg-admin-primary hover:bg-admin-primary-dark text-white font-medium rounded-lg transition-colors"
        >
          <Plus size={18} />
          Add Category
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-2xl font-bold text-gray-900">{mainCategories.length}</p>
          <p className="text-sm text-gray-500">Main Categories</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-2xl font-bold text-gray-900">
            {categories.filter((c) => c.parentId !== null).length}
          </p>
          <p className="text-sm text-gray-500">Subcategories</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-2xl font-bold text-green-600">
            {categories.filter((c) => c.isActive).length}
          </p>
          <p className="text-sm text-gray-500">Active</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-2xl font-bold text-gray-400">
            {categories.filter((c) => !c.isActive).length}
          </p>
          <p className="text-sm text-gray-500">Inactive</p>
        </div>
      </div>

      {/* Categories Tree */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
          <div className="flex items-center gap-2">
            <FolderTree size={18} className="text-admin-primary" />
            <h2 className="font-semibold text-gray-900">Category Structure</h2>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Click on categories to expand subcategories. Drag to reorder.
          </p>
        </div>

        {mainCategories.length > 0 ? (
          <div>{mainCategories.map((cat) => renderCategory(cat))}</div>
        ) : (
          <div className="text-center py-12">
            <Folder size={48} className="mx-auto text-gray-200 mb-4" />
            <p className="text-gray-500">No categories yet</p>
            <button
              onClick={() => handleOpenModal()}
              className="mt-4 text-admin-primary hover:underline text-sm"
            >
              Create your first category
            </button>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editingCategory ? 'Edit Category' : 'Add New Category'}
        size="md"
      >
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div>
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">
              Category Name *
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-admin-primary"
              placeholder="e.g., Electronics"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">
              Description
            </label>
            <textarea
              rows={3}
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-admin-primary resize-none"
              placeholder="Brief description of this category..."
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">
              Parent Category
            </label>
            <select
              value={formData.parentId || ''}
              onChange={(e) =>
                setFormData({ ...formData, parentId: e.target.value || null })
              }
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-admin-primary"
            >
              <option value="">None (Main Category)</option>
              {mainCategories
                .filter((cat) => cat.id !== editingCategory?.id)
                .map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Select a parent to make this a subcategory
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">
              Sort Order
            </label>
            <input
              type="number"
              min="1"
              value={formData.sortOrder}
              onChange={(e) =>
                setFormData({ ...formData, sortOrder: parseInt(e.target.value) || 1 })
              }
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-admin-primary"
            />
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="isActive"
              checked={formData.isActive}
              onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
              className="w-4 h-4 rounded text-admin-primary"
            />
            <label htmlFor="isActive" className="text-sm text-gray-700">
              Active (visible in store)
            </label>
          </div>

          <div className="flex gap-3 pt-4 border-t border-gray-100">
            <button
              type="submit"
              className="flex-1 py-2.5 bg-admin-primary hover:bg-admin-primary-dark text-white font-medium rounded-lg transition-colors"
            >
              {editingCategory ? 'Save Changes' : 'Add Category'}
            </button>
            <button
              type="button"
              onClick={() => setShowModal(false)}
              className="px-6 py-2.5 border border-gray-200 text-gray-600 font-medium rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation */}
      <Modal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="Delete Category"
        size="sm"
      >
        <div className="p-6">
          <p className="text-gray-600 mb-2">
            Are you sure you want to delete this category?
          </p>
          {deleteConfirm && getSubCategories(deleteConfirm).length > 0 && (
            <p className="text-amber-600 text-sm bg-amber-50 p-3 rounded-lg mb-4">
              ⚠️ This will also delete {getSubCategories(deleteConfirm).length}{' '}
              subcategories!
            </p>
          )}
          <div className="flex gap-3 mt-6">
            <button
              onClick={() => handleDelete(deleteConfirm!)}
              className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 text-white font-medium rounded-lg transition-colors"
            >
              Delete
            </button>
            <button
              onClick={() => setDeleteConfirm(null)}
              className="flex-1 py-2.5 border border-gray-200 text-gray-600 font-medium rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
