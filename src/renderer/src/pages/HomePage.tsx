import { Link } from 'react-router-dom'

export default function HomePage() {
  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">欢迎使用轻小说文库下载器</h2>
      <p className="text-gray-400 mb-6">
        本工具可用于下载轻小说文库的小说并保存为 EPUB 格式。
      </p>
      <div className="grid grid-cols-2 gap-4">
        <Link to="/search/id" className="p-4 rounded-lg border border-gray-800 hover:border-blue-500/50 hover:bg-gray-800/50 transition-colors">
          <h3 className="font-semibold mb-1">编号检索</h3>
          <p className="text-sm text-gray-500">按书籍编号查询详情</p>
        </Link>
        <Link to="/search/author" className="p-4 rounded-lg border border-gray-800 hover:border-blue-500/50 hover:bg-gray-800/50 transition-colors">
          <h3 className="font-semibold mb-1">作者检索</h3>
          <p className="text-sm text-gray-500">按作者名搜索作品</p>
        </Link>
        <Link to="/search/title" className="p-4 rounded-lg border border-gray-800 hover:border-blue-500/50 hover:bg-gray-800/50 transition-colors">
          <h3 className="font-semibold mb-1">书名检索</h3>
          <p className="text-sm text-gray-500">按书名搜索作品</p>
        </Link>
        <Link to="/config" className="p-4 rounded-lg border border-gray-800 hover:border-blue-500/50 hover:bg-gray-800/50 transition-colors">
          <h3 className="font-semibold mb-1">配置</h3>
          <p className="text-sm text-gray-500">账号、Cookie 与下载设置</p>
        </Link>
      </div>
    </div>
  )
}
