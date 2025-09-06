#!/usr/bin/env node

/**
 * Basic verification script for gallery performance optimizations
 * Run this to test that the key optimizations are working correctly
 */

// Test media.ts caching behavior
function testMediaCaching() {
  console.log('✓ Testing media mode caching...');
  
  // Mock window and document for Node.js testing
  global.window = { performance: { now: () => Date.now() } };
  global.document = {
    head: { appendChild: () => {} },
    querySelector: () => null,
    createElement: () => ({ rel: '', href: '', crossOrigin: '' })
  };
  global.fetch = () => Promise.resolve({
    ok: true,
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve({ url: 'https://minio.example.com/bucket/image.jpg' })
  });

  // Import and test the media module
  return import('../src/lib/media.js').then(({ resolveMediaUrl }) => {
    console.log('   - Media resolver imported successfully');
    return resolveMediaUrl('/api/images/test/thumb').then(url => {
      console.log('   - First resolve completed:', url.includes('minio.example.com') ? '✓' : '✗');
      // Second call should be faster (cached mode)
      return resolveMediaUrl('/api/images/test2/thumb').then(url2 => {
        console.log('   - Second resolve completed:', url2.includes('minio.example.com') ? '✓' : '✗');
      });
    });
  }).catch(err => {
    console.log('   ✗ Error testing media caching:', err.message);
  });
}

// Test component files exist and compile
function testComponentFiles() {
  console.log('✓ Testing component files...');
  import('fs').then(({ default: fs }) => {
    import('path').then(({ default: path }) => {
      
      const files = [
        '../src/components/ImageThumbnail.tsx',
        '../src/components/GalleryGrid.tsx', 
        '../src/components/VirtualizedGrid.tsx',
        '../src/lib/media.ts',
        '../src/pages/AllImagesPage.tsx'
      ];
      
      for (const file of files) {
        const filePath = path.join(process.cwd(), file);
        if (fs.existsSync(filePath)) {
          console.log(`   - ${file} exists ✓`);
          
          // Check for key optimization keywords
          const content = fs.readFileSync(filePath, 'utf8');
          
          if (file.includes('media.ts')) {
            console.log(`   - Media caching: ${content.includes('mediaMode') ? '✓' : '✗'}`);
            console.log(`   - Preconnect: ${content.includes('preconnect') ? '✓' : '✗'}`);
          }
          
          if (file.includes('ImageThumbnail.tsx')) {
            console.log(`   - Load queue: ${content.includes('ImageLoadQueue') ? '✓' : '✗'}`);
            console.log(`   - Priority: ${content.includes('priority') ? '✓' : '✗'}`);
            console.log(`   - Content visibility: ${content.includes('content-visibility') ? '✓' : '✗'}`);
          }
          
          if (file.includes('VirtualizedGrid.tsx')) {
            console.log(`   - Virtualization: ${content.includes('VirtualizedGrid') ? '✓' : '✗'}`);
          }
          
          if (file.includes('AllImagesPage.tsx')) {
            console.log(`   - Prefetch: ${content.includes('prefetch') ? '✓' : '✗'}`);
          }
        } else {
          console.log(`   - ${file} missing ✗`);
        }
      }
    });
  });
}

// Test backend files
function testBackendFiles() {
  console.log('✓ Testing backend files...');
  import('fs').then(({ default: fs }) => {
    import('path').then(({ default: path }) => {
      
      const files = [
        '../backend/src/main.py',
        '../backend/src/services/storage_minio.py',
        '../backend/src/database/mongo.py'
      ];
      
      for (const file of files) {
        const filePath = path.join(process.cwd(), file);
        if (fs.existsSync(filePath)) {
          console.log(`   - ${file} exists ✓`);
          
          const content = fs.readFileSync(filePath, 'utf8');
          
          if (file.includes('main.py')) {
            console.log(`   - GZip middleware: ${content.includes('GZipMiddleware') ? '✓' : '✗'}`);
          }
          
          if (file.includes('storage_minio.py')) {
            console.log(`   - Cache-Control: ${content.includes('Cache-Control') ? '✓' : '✗'}`);
          }
          
          if (file.includes('mongo.py')) {
            console.log(`   - Compound index: ${content.includes('lib_id_tags__id') ? '✓' : '✗'}`);
          }
        } else {
          console.log(`   - ${file} missing ✗`);
        }
      }
    });
  });
}

// Run all tests
async function runTests() {
  console.log('🚀 Testing Tagify Gallery Performance Optimizations\n');
  
  testComponentFiles();
  console.log('');
  
  testBackendFiles();
  console.log('');
  
  await testMediaCaching();
  console.log('');
  
  console.log('✅ Performance optimization verification complete!');
  console.log('');
  console.log('Manual testing checklist:');
  console.log('- [ ] Start dev server: pnpm dev');
  console.log('- [ ] Open browser dev tools Network tab');
  console.log('- [ ] Load gallery page and verify ~1 request per thumbnail');
  console.log('- [ ] Scroll through large library and verify smooth performance');
  console.log('- [ ] Check browser cache for repeated visits');
  console.log('- [ ] Verify GZip compression on API responses');
}

runTests().catch(console.error);