import { initApp } from './init.js';
import { getSupabase, showToast, getUser, onAuthChange } from './auth.js';
import { getCache, setCache, invalidateCache } from './cache.js';

document.getElementById('current-year').textContent = new Date().getFullYear();

initApp();

if (new URLSearchParams(window.location.search).get('deleted') === '1') {
  showToast('Votre compte a été supprimé avec succès.', 'success');
  window.history.replaceState({}, '', window.location.pathname);
}

const supabase = getSupabase();
let currentFavorites = new Set();

async function loadFavorites() {
  const user = getUser();
  if (!user) { currentFavorites = new Set(); updateHomeFavButtons(); return; }
  const { data } = await supabase
    .from('favorites')
    .select('product_id')
    .eq('user_id', user.id);
  currentFavorites = new Set((data || []).map(f => f.product_id));
  updateHomeFavButtons();
}

function updateHomeFavButtons() {
  document.querySelectorAll('.btn-fav-home').forEach(btn => {
    const id = btn.dataset.id;
    const isFav = currentFavorites.has(id);
    btn.classList.toggle('fav-active', isFav);
    btn.querySelector('i').className = isFav ? 'bi bi-heart-fill' : 'bi bi-heart';
  });
}

async function toggleHomeFavorite(productId, btn) {
  const user = getUser();
  if (!user) {
    const modals = document.querySelectorAll('.modal');
    const authModal = Array.from(modals).find(m => m.id === 'authModal');
    if (authModal) new bootstrap.Modal(authModal).show();
    return;
  }
  const isFav = currentFavorites.has(productId);
  if (isFav) {
    await supabase.from('favorites').delete().eq('user_id', user.id).eq('product_id', productId);
    currentFavorites.delete(productId);
  } else {
    await supabase.from('favorites').insert({ user_id: user.id, product_id: productId });
    currentFavorites.add(productId);
  }
  updateHomeFavButtons();
}

onAuthChange(() => loadFavorites());

function renderHomeData(categories, products) {
    const catContainer = document.getElementById('dynamic-categories');
    document.getElementById('loading-categories').style.display = 'none';

    if (!categories.length) {
        catContainer.innerHTML = '<p class="text-muted">Aucune catégorie disponible.</p>';
    } else {
        let catHtml = '';
        categories.forEach(cat => {
            const prodInCat = products.find(p => p.category === cat.id);
            const fallbackImg = 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'100%25\' height=\'200\'%3E%3Crect width=\'100%25\' height=\'100%25\' fill=\'%23e9ecef\'/%3E%3Ctext x=\'50%25\' y=\'50%25\' fill=\'%23adb5bd\' font-family=\'sans-serif\' font-size=\'16\' text-anchor=\'middle\' dominant-baseline=\'middle\'%3ECatégorie %3C/text%3E%3C/svg%3E';
            const coverImage = (prodInCat && prodInCat.image_url) ? prodInCat.image_url : fallbackImg;

            catHtml += `
                <div>
                    <div class="card category-card text-center shadow-sm h-100 border-0">
                        <img src="${coverImage}" class="card-img-top category-image" alt="${cat.label}"
                             onerror="this.src='${fallbackImg}'">
                        <div class="card-body d-flex flex-column border border-top-0 rounded-bottom">
                            <h5 class="card-title fw-bold" style="color: #0d1b4b;">${cat.label}</h5>
                            <p class="card-text text-muted small mb-4">Découvrez toute notre gamme dans cette catégorie.</p>
                            <a href="produits.html#${cat.id}" class="btn btn-outline-primary mt-auto w-100 fw-semibold">Découvrir</a>
                        </div>
                    </div>
                </div>`;
        });
        catContainer.innerHTML = catHtml;
    }

    const prodContainer = document.getElementById('dynamic-featured-products');
    document.getElementById('loading-products').style.display = 'none';

    if (!products.length) {
        prodContainer.innerHTML = '<p class="text-muted text-center w-100">Aucun produit disponible.</p>';
    } else {
        const latestProducts = products.slice(0, 4);
        let prodHtml = '';

        latestProducts.forEach(p => {
            const price = Number(p.price).toLocaleString('fr-FR');
            const oldPriceHtml = p.compare_at_price ? `<span class="old-price">${Number(p.compare_at_price).toLocaleString('fr-FR')}</span> ` : '';
            prodHtml += `
                <div class="col-6 col-md-3">
                    <div class="card h-100 shadow-sm border-0 position-relative" style="transition: transform 0.2s;">
                        <button class="btn-fav-home" data-id="${p.id}" title="Ajouter aux favoris">
                            <i class="bi bi-heart"></i>
                        </button>
                        <img src="${p.image_url}" class="card-img-top product-thumb" alt="${p.name}" 
                             onerror="this.src='data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'100%25\' height=\'180\'%3E%3Crect width=\'100%25\' height=\'100%25\' fill=\'%23f0f4fb\'/%3E%3C/svg%3E'">
                        <div class="card-body d-flex flex-column border border-top-0 rounded-bottom p-3">
                            <h6 class="card-title fw-bold mb-1 text-truncate" title="${p.name}">${p.name}</h6>
                            <div class="text-primary fw-bold mt-auto">${oldPriceHtml}${price} <small>CFA</small></div>
                            <a href="produits.html?quickview=${p.id}" class="btn btn-sm btn-primary w-100 mt-2">Voir le produit</a>
                        </div>
                    </div>
                </div>`;
        });
        prodContainer.innerHTML = prodHtml;

        prodContainer.querySelectorAll('.btn-fav-home').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleHomeFavorite(btn.dataset.id, btn);
            });
        });

        loadFavorites();
    }
}

async function loadHomeData() {
    const cached = getCache('home_data');
    if (cached) {
        renderHomeData(cached.categories, cached.products);
    }

    try {
        const [catRes, prodRes] = await Promise.all([
            supabase.from('categories').select('id, label, sort_order').order('sort_order'),
            supabase.from('products').select('id, name, price, compare_at_price, image_url, category, created_at').eq('active', true).order('created_at', { ascending: false })
        ]);

        if (catRes.error) throw catRes.error;
        if (prodRes.error) throw prodRes.error;

        const categories = catRes.data || [];
        const products = prodRes.data || [];

        setCache('home_data', { categories, products });

        if (!cached) {
            renderHomeData(categories, products);
        }

    } catch (error) {
        console.error("Erreur lors du chargement des données :", error);
        if (!cached) {
            document.getElementById('loading-categories').innerHTML = '<div class="alert alert-danger">Erreur lors de la récupération des catégories.</div>';
            document.getElementById('loading-products').innerHTML = '<div class="alert alert-danger">Erreur lors de la récupération des produits.</div>';
        }
    }
}

document.addEventListener("DOMContentLoaded", loadHomeData);